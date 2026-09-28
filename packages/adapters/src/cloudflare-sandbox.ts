import { randomUUID } from "node:crypto";
import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerFileEntry,
  ComputerInput,
  ComputerObservation,
  ComputerRef,
  ControlLeaseRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  ScreenSession,
} from "@rakazo/adapter-kit";
import { boundedSandboxCommandTimeoutMs } from "@rakazo/core";
import { ComputerScreenUnavailableError } from "./computer-screens.js";
import { shellQuote } from "./computer-support.js";
import { LinuxDesktop } from "./linux-desktop.js";

/** The control agent baked into the cloudflare computer image listens here. */
export const CLOUDFLARE_AGENT_PORT = 8090;
/**
 * The workspace IS the R2 mount: data lives in the bucket under
 * `homes/<homeKey>/`, so it survives the container's ephemeral disk
 * being discarded on sleep and needs no workspace import/export.
 */
export const CLOUDFLARE_HOME = "/home/rakazo";
/** Browser profiles stay on container disk: FUSE locks are not worth the risk (v1). */
const CLOUDFLARE_BROWSER_PROFILES = "/var/rakazo/browser-profiles";

const DESKTOP_ENVIRONMENT = {
  homeDir: CLOUDFLARE_HOME,
  workspaceDir: CLOUDFLARE_HOME,
  browserProfilesDir: CLOUDFLARE_BROWSER_PROFILES,
  displayStart: 20,
  portStart: 6100,
} as const;

export interface CloudflareBridgeConfig {
  /** Base URL of the deployed cf-bridge Worker, e.g. https://cf-bridge.example.workers.dev */
  bridgeUrl: string;
  /** Shared bearer token the bridge expects on every request. */
  bridgeToken: string;
  fetchImpl?: typeof fetch;
  /** Test hook: mount wait budgets in ms. */
  mountWait?: { initialMs?: number; reprovisionMs?: number; pollMs?: number };
}

interface AgentExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class CloudflareContainerGoneError extends Error {
  constructor(id: string) {
    super(`cloudflare container ${id} is gone (discarded on sleep or destroyed)`);
    this.name = "CloudflareContainerGoneError";
  }
}

export class CloudflareSandboxProvider implements SandboxProvider {
  private readonly desktops = new LinuxDesktop({
    environment: async () => ({ ...DESKTOP_ENVIRONMENT }),
    run: async (computer, command, context) => {
      const result = await this.exec(
        computer,
        `bash -c ${shellQuote(command)}`,
        boundedSandboxCommandTimeoutMs(undefined),
        context.signal,
      );
      return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    },
    screenUrl: async (computer, port) =>
      `${this.config.bridgeUrl}/v1/computers/${encodeURIComponent(computer.providerRef)}/screen/${encodeURIComponent(String(port))}/embed.html`,
  });

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CloudflareBridgeConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  describe() {
    return {
      id: "cloudflare",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: true,
        pty: true,
        snapshots: true,
        takeover: true,
        persistentHome: true,
        multiScreen: true,
      },
    };
  }

  async provision(
    request: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
    },
    _context: AdapterContext,
  ): Promise<ComputerRef> {
    const id = request.providerRef || `cf-${randomUUID()}`;
    if (request.providerRef && request.providerKind === "cloudflare") {
      const state = await this.bridgeState(request.providerRef);
      if (state === "running") {
        return {
          id: request.providerRef,
          botId: request.botId,
          kind: "cloudflare",
          providerRef: request.providerRef,
          fresh: false,
        };
      }
    }
    await this.bridge("POST", "/v1/computers", {
      body: JSON.stringify({
        computerId: id,
        // The lifecycle passes the home key as botId; it already partitions by
        // user/bot (`team-<spaceId>` or `<botId>`) and doubles as the R2 prefix.
        homeKey: request.botId,
      }),
      headers: { "content-type": "application/json" },
    });
    return { id, botId: request.botId, kind: "cloudflare", providerRef: id, fresh: true };
  }

  async prepare(computer: ComputerRef, context: AdapterContext): Promise<void> {
    const initialMs = this.config.mountWait?.initialMs ?? 20_000;
    const reprovisionMs = this.config.mountWait?.reprovisionMs ?? 90_000;
    const pollMs = this.config.mountWait?.pollMs ?? 2_000;
    if (await this.waitForMount(computer, context, initialMs, pollMs)) return;
    // Cloudflare sometimes restarts containers with default options — without
    // the provision env (observed after a crash/maintenance restart). The boot
    // then has a skeleton home and no R2 mount, and no amount of retrying
    // heals it. Replace the container instead: data lives on R2, container
    // disk is ephemeral by design.
    await this.bridge("DELETE", `/v1/computers/${encodeURIComponent(computer.providerRef)}`).catch(
      () => undefined,
    );
    await this.bridge("POST", "/v1/computers", {
      body: JSON.stringify({ computerId: computer.providerRef, homeKey: computer.botId }),
      headers: { "content-type": "application/json" },
    });
    if (!(await this.waitForMount(computer, context, reprovisionMs, pollMs))) {
      throw new Error(`workspace is not mounted at ${CLOUDFLARE_HOME}`);
    }
  }

  /** Poll the in-container mount check until it appears or the budget runs out. */
  private async waitForMount(
    computer: ComputerRef,
    context: AdapterContext,
    budgetMs: number,
    pollMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    for (;;) {
      // Exec can fail while the container is still booting (agent not up yet):
      // treat that the same as "not mounted yet" and keep polling.
      const mounted = await this.exec(
        computer,
        `bash -c ${shellQuote(`grep -qs " ${CLOUDFLARE_HOME} fuse" /proc/mounts`)}`,
        boundedSandboxCommandTimeoutMs(undefined),
        context.signal,
      ).catch(() => null);
      if (mounted?.code === 0) return true;
      if (context.signal.aborted || Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const timeoutMs = boundedSandboxCommandTimeoutMs(request.timeoutMs);
    const script = request.argv.map(shellQuote).join(" ");
    const withCwd = request.cwd ? `cd ${shellQuote(request.cwd)} || exit 1\n${script}` : script;
    let result: AgentExecResult;
    try {
      result = await this.exec(computer, withCwd, timeoutMs, context.signal);
    } catch (error) {
      if (context.signal.aborted) {
        yield { type: "stderr", data: `command aborted\n` };
        yield { type: "exit", code: 124 };
        return;
      }
      throw error;
    }
    if (result.stdout) yield { type: "stdout", data: result.stdout };
    if (result.stderr) yield { type: "stderr", data: result.stderr };
    yield { type: "exit", code: result.code };
  }

  async connectScreen(
    computer: ComputerRef,
    request: ScreenRequest,
    context: AdapterContext,
  ): Promise<ScreenSession> {
    try {
      return await this.desktops.connectScreen(computer, request, context);
    } catch (error) {
      // A container that just woke from sleep races its own desktop startup
      // (Xvfb/window manager land seconds after the API call) and the first
      // desktop command can fail with an empty stderr. Retry once, then
      // surface a friendly retry-me error instead of a 500.
      if (
        error instanceof CloudflareContainerGoneError ||
        error instanceof ComputerScreenUnavailableError ||
        context.signal.aborted
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (context.signal.aborted) throw error;
      try {
        return await this.desktops.connectScreen(computer, request, context);
      } catch {
        throw new ComputerScreenUnavailableError("เครื่องบอทกำลังเริ่มใหม่ ลองเปิดจออีกครั้งในอีกสักครู่");
      }
    }
  }
  async setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    context: AdapterContext,
    controlToken?: string,
  ): Promise<void> {
    return this.desktops.setScreenControl(computer, interactive, context, controlToken);
  }
  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    _lease: ControlLeaseRef,
    context: AdapterContext,
  ): Promise<void> {
    return this.desktops.sendInput(computer, input, context);
  }
  async observe(computer: ComputerRef, context: AdapterContext): Promise<ComputerObservation> {
    return this.desktops.observe(computer, context);
  }
  async act(computer: ComputerRef, request: ComputerActionRequest, context: AdapterContext) {
    return this.desktops.act(computer, request, context);
  }
  async releaseScreen(computer: ComputerRef, context: AdapterContext): Promise<void> {
    return this.desktops.releaseScreen(computer, context);
  }

  async listFiles(
    computer: ComputerRef,
    directory: string,
    context: AdapterContext,
  ): Promise<ComputerFileEntry[]> {
    const relative = directory === "." || directory === "/" ? "" : directory;
    const target = relative ? `${CLOUDFLARE_HOME}/${relative.replace(/^\//, "")}` : CLOUDFLARE_HOME;
    const listing = await this.exec(
      computer,
      `bash -c ${shellQuote(
        `cd ${shellQuote(target)} && find . -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%m\\t%f\\n'`,
      )}`,
      boundedSandboxCommandTimeoutMs(undefined),
      context.signal,
    );
    if (listing.code !== 0) return [];
    const entries: ComputerFileEntry[] = [];
    for (const line of listing.stdout.split("\n")) {
      const [type, size, mode, ...name] = line.split("\t");
      if (!name.length || (type !== "f" && type !== "d")) continue;
      const path = relative ? `${relative.replace(/\/$/, "")}/${name.join("\t")}` : name.join("\t");
      entries.push({
        path,
        kind: type === "d" ? "dir" : "file",
        size: Number(size) || 0,
        ...(Number(mode) & 0o100 ? { executable: true } : {}),
      });
    }
    return entries;
  }

  async readFile(
    computer: ComputerRef,
    filePath: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ): Promise<Uint8Array> {
    const target = `${CLOUDFLARE_HOME}/${filePath.replace(/^\//, "")}`;
    if (options?.maxBytes !== undefined) {
      const stat = await this.exec(
        computer,
        `bash -c ${shellQuote(`stat -c %s ${shellQuote(target)}`)}`,
        boundedSandboxCommandTimeoutMs(undefined),
        context.signal,
      );
      if (Number(stat.stdout.trim()) > options.maxBytes) {
        throw new Error(`computer file exceeds ${options.maxBytes} bytes`);
      }
    }
    const response = await this.bridge(
      "GET",
      `/v1/computers/${encodeURIComponent(computer.providerRef)}/agent/files/read?path=${encodeURIComponent(target)}`,
      { signal: context.signal },
    );
    if (!response.ok) {
      if (response.status === 404) throw new Error(`no such file: ${filePath}`);
      throw new Error(`computer file read failed (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async writeFile(
    computer: ComputerRef,
    file: PortableFile,
    context: AdapterContext,
  ): Promise<void> {
    const target = `${CLOUDFLARE_HOME}/${file.path.replace(/^\//, "")}`;
    const response = await this.bridge(
      "PUT",
      `/v1/computers/${encodeURIComponent(computer.providerRef)}/agent/files/write?path=${encodeURIComponent(target)}`,
      {
        // Runtime fetch accepts typed arrays even though the DOM BodyInit
        // type omits them.
        body: file.content as unknown as BodyInit,
        signal: context.signal,
        headers: { "content-type": "application/octet-stream" },
      },
    );
    if (!response.ok) throw new Error(`computer file write failed (${response.status})`);
    if (file.executable) {
      await this.exec(
        computer,
        `bash -c ${shellQuote(`chmod 700 ${shellQuote(target)}`)}`,
        boundedSandboxCommandTimeoutMs(undefined),
        context.signal,
      );
    }
  }

  /**
   * The home directory is the R2 mount itself, so the workspace is always
   * durable: there is nothing to import or export.
   */
  async *exportWorkspace(): AsyncIterable<PortableFile> {}
  async importWorkspace(): Promise<void> {}

  async snapshot(computer: ComputerRef, context: AdapterContext) {
    const observation = await this.observe(computer, context);
    return { id: observation.frameId, createdAt: observation.capturedAt };
  }

  async keepAlive(computer: ComputerRef): Promise<void> {
    const response = await this.bridge(
      "GET",
      `/v1/computers/${encodeURIComponent(computer.providerRef)}/ping`,
    );
    if (response.status === 404 || response.status === 410) {
      throw new CloudflareContainerGoneError(computer.providerRef);
    }
  }

  async stop(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    await this.bridge(
      "POST",
      `/v1/computers/${encodeURIComponent(computer.providerRef)}/stop`,
    ).catch(() => undefined);
  }

  async destroy(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    await this.bridge("DELETE", `/v1/computers/${encodeURIComponent(computer.providerRef)}`).catch(
      () => undefined,
    );
  }

  /** Bridge container state, or "gone" when the id no longer exists. */
  private async bridgeState(id: string): Promise<"running" | "gone"> {
    const response = await this.bridge("GET", `/v1/computers/${encodeURIComponent(id)}`);
    if (response.status === 404 || response.status === 410) return "gone";
    if (!response.ok) throw new Error(`cloudflare bridge status failed (${response.status})`);
    return ((await response.json()) as { state?: string }).state === "running" ? "running" : "gone";
  }

  private async exec(
    computer: ComputerRef,
    script: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentExecResult> {
    const response = await this.bridge(
      "POST",
      `/v1/computers/${encodeURIComponent(computer.providerRef)}/agent/exec`,
      {
        body: JSON.stringify({ script, timeoutMs }),
        headers: { "content-type": "application/json" },
        signal,
      },
    );
    if (response.status === 404 || response.status === 410) {
      throw new CloudflareContainerGoneError(computer.providerRef);
    }
    if (!response.ok) throw new Error(`computer exec failed (${response.status})`);
    return (await response.json()) as AgentExecResult;
  }

  private async bridge(
    method: string,
    path: string,
    init?: { body?: BodyInit; headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<Response> {
    return this.fetchImpl(`${this.config.bridgeUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.bridgeToken}`,
        ...(init?.headers ?? {}),
      },
      ...(init?.body !== undefined ? { body: init.body } : {}),
      ...(init?.signal ? { signal: init.signal } : {}),
    });
  }
}
