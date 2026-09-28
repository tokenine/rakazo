import { Container, getContainer, switchPort } from "@cloudflare/containers";

/** Must match AGENT_PORT in ./container/agent.js. */
const AGENT_PORT = 8090;

/**
 * One Durable Object (with an attached Container) per rakazo computer. The DO
 * name is the computer id the API provider generates (`cf-<uuid>`), which keeps
 * container identity stable across sleep/wake: the container is recreated from
 * the image and the workspace comes back from the R2 home mount.
 */
export class RakazoComputerContainer extends Container {
  defaultPort = AGENT_PORT;
  // Idle containers sleep themselves out; keepAlive pings through the bridge
  // to renew this while a run is active. Disk is ephemeral by design — the
  // home lives on R2.
  sleepAfter = "10m";

  /** Store the provision env and start with it (R2 prefix + credentials). */
  async provision(envVars: Record<string, string>): Promise<void> {
    await this.ctx.storage.put("envVars", envVars);
    await this.start({ envVars });
  }

  /**
   * Re-start a slept container with its stored provision env. Plain fetches
   * auto-start without env, which would boot a computer with no R2 home —
   * so every proxy route gates through this first.
   */
  async ensureStarted(): Promise<void> {
    const state = await this.getState();
    if (state.status === "running" || state.status === "healthy") return;
    const stored = await this.ctx.storage.get<Record<string, string>>("envVars");
    if (!stored) throw new Error("computer not provisioned");
    await this.start({ envVars: stored });
  }
}

export interface Env {
  COMPUTERS: DurableObjectNamespace<RakazoComputerContainer>;
  /** Secret: shared bearer token the API provider must send. */
  BRIDGE_TOKEN?: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  /** Secrets: S3 credentials for the R2 home bucket. */
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One bucket for the whole deployment, partitioned per user/bot home. */
function homePrefix(homeKey: unknown): string {
  const safe = typeof homeKey === "string" ? homeKey.replace(/[^A-Za-z0-9_-]/g, "") : "";
  if (!safe) throw new HttpError(400, "homeKey is required");
  return `homes/${safe}`;
}

function computerId(segments: string[]): string {
  const id = segments[2] ?? "";
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpError(400, "bad computer id");
  return id;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get("authorization");
    if (!env.BRIDGE_TOKEN || auth !== `Bearer ${env.BRIDGE_TOKEN}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "v1" || segments[1] !== "computers") {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    try {
      // POST /v1/computers (collection create) carries no id segment.
      if (segments.length === 2) {
        if (request.method !== "POST") throw new HttpError(405, "method not allowed");
        const body = (await request.json()) as { computerId?: string; homeKey?: string };
        const newId = typeof body.computerId === "string" ? body.computerId : "";
        if (!/^[A-Za-z0-9_-]+$/.test(newId)) throw new HttpError(400, "bad computer id");
        return await startComputer(env, newId, body.homeKey);
      }
      return await route(request, env, url, segments);
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

async function startComputer(env: Env, id: string, homeKey: unknown): Promise<Response> {
  const prefix = homePrefix(homeKey);
  await getContainer(env.COMPUTERS, id).provision({
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_BUCKET: env.R2_BUCKET,
    R2_PREFIX: prefix,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID ?? "",
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY ?? "",
  });
  return Response.json({ ok: true, id });
}

async function route(request: Request, env: Env, url: URL, segments: string[]): Promise<Response> {
  const id = computerId(segments);
  const container = getContainer(env.COMPUTERS, id);
  const rest = segments.slice(3);

  // /v1/computers/:id — lifecycle
  if (rest.length === 0) {
    if (request.method === "POST") {
      const body = (await request.json()) as { homeKey?: string };
      return startComputer(env, id, body.homeKey);
    }
    if (request.method === "DELETE") {
      await container.destroy();
      return Response.json({ ok: true });
    }
    if (request.method === "GET") {
      const state = await container.getState();
      const running = state.status === "running" || state.status === "healthy";
      return Response.json({ state: running ? "running" : "stopped" });
    }
    throw new HttpError(405, "method not allowed");
  }

  // /v1/computers/:id/stop — graceful sleep; the R2 home needs no checkpoint
  if (rest[0] === "stop" && rest.length === 1 && request.method === "POST") {
    await container.stop();
    return Response.json({ ok: true });
  }

  // /v1/computers/:id/ping — keepAlive; also renews the sleep timer
  if (rest[0] === "ping" && rest.length === 1 && request.method === "GET") {
    await container.ensureStarted();
    return container.fetch(new Request("https://container/ping"));
  }

  // /v1/computers/:id/agent/* — control agent passthrough (exec, files)
  if (rest[0] === "agent" && rest.length >= 2) {
    const sub = `/${rest.slice(1).join("/")}${url.search}`;
    await container.ensureStarted();
    return container.fetch(new Request(`https://container${sub}`, request));
  }

  // /v1/computers/:id/screen/:port/* — noVNC page + websockify WebSocket
  if (rest[0] === "screen" && rest.length >= 3) {
    const port = Number(rest[1]);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new HttpError(400, "bad screen port");
    }
    await container.ensureStarted();
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      // WebSocket upgrades must be forwarded UNTOUCHED: rebuilding a Request
      // drops the runtime's upgrade binding and the proxy fails (observed 500).
      // websockify accepts any path — the token rides in the query string.
      return container.fetch(switchPort(request, port));
    }
    const sub = `/${rest.slice(2).join("/")}${url.search}`;
    return container.fetch(switchPort(new Request(`https://container${sub}`, request), port));
  }

  throw new HttpError(404, "not found");
}
