import { describe, expect, it } from "vitest";
import { CloudflareContainerGoneError, CloudflareSandboxProvider } from "./cloudflare-sandbox.js";
import { createSandboxProvider } from "./sandbox-factory.js";

const ctx = {
  operationId: "op",
  traceId: "tr",
  spaceId: "ws",
  userId: "user",
  signal: new AbortController().signal,
};

interface RecordedRequest {
  method: string;
  path: string;
  body?: string;
}

function makeProvider(
  handler: (request: RecordedRequest) => { status?: number; json?: unknown } | undefined,
) {
  const requests: RecordedRequest[] = [];
  const provider = new CloudflareSandboxProvider({
    bridgeUrl: "https://bridge.test",
    bridgeToken: "tok",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.replace("https://bridge.test", "");
      const body = typeof init?.body === "string" ? init.body : undefined;
      const request: RecordedRequest = { method: init?.method ?? "GET", path, body };
      requests.push(request);
      const response = handler(request) ?? {};
      return new Response(response.json === undefined ? null : JSON.stringify(response.json), {
        status: response.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  return { provider, requests };
}

describe("CloudflareSandboxProvider", () => {
  it("provisions a fresh container with the home key as the R2 prefix input", async () => {
    const { provider, requests } = makeProvider(() => ({}));
    const ref = await provider.provision({ botId: "team-space1", homePath: "/x" }, ctx);
    expect(ref).toMatchObject({
      kind: "cloudflare",
      fresh: true,
      botId: "team-space1",
    });
    expect(ref.providerRef).toMatch(/^cf-/);
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/v1/computers",
        body: JSON.stringify({ computerId: ref.providerRef, homeKey: "team-space1" }),
      },
    ]);
  });

  it("reconnects a live container without recreating it", async () => {
    const { provider, requests } = makeProvider((request) =>
      request.path.endsWith("/computers/cf-live") ? { json: { state: "running" } } : {},
    );
    const ref = await provider.provision(
      { botId: "bot1", homePath: "/x", providerRef: "cf-live", providerKind: "cloudflare" },
      ctx,
    );
    expect(ref).toMatchObject({ providerRef: "cf-live", fresh: false, kind: "cloudflare" });
    expect(requests).toEqual([{ method: "GET", path: "/v1/computers/cf-live", body: undefined }]);
  });

  it("replaces a container that sleeped itself out of existence", async () => {
    const { provider, requests } = makeProvider((request) =>
      request.path.endsWith("/computers/cf-dead") ? { status: 404 } : {},
    );
    const ref = await provider.provision(
      { botId: "bot1", homePath: "/x", providerRef: "cf-dead", providerKind: "cloudflare" },
      ctx,
    );
    // The id is intentionally stable across sleep/wake: the container is
    // recreated under the same name and the workspace comes back from R2.
    expect(ref.providerRef).toBe("cf-dead");
    expect(ref.fresh).toBe(true);
    expect(requests.at(-1)).toMatchObject({
      method: "POST",
      path: "/v1/computers",
      body: JSON.stringify({ computerId: "cf-dead", homeKey: "bot1" }),
    });
  });

  it("runs commands through the agent and yields the exit code", async () => {
    const { provider } = makeProvider((request) => {
      if (request.path.endsWith("/agent/exec")) {
        return { json: { code: 3, stdout: "out", stderr: "err" } };
      }
      return { status: 404 };
    });
    const ref = await provider.provision({ botId: "b", homePath: "/x" }, ctx);
    const events = [];
    for await (const event of provider.execute(ref, { argv: ["echo", "hi"] }, ctx)) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "stdout", data: "out" },
      { type: "stderr", data: "err" },
      { type: "exit", code: 3 },
    ]);
  });

  it("fails prepare when the workspace is not mounted", async () => {
    const { provider } = makeProvider((request) =>
      request.path.endsWith("/agent/exec")
        ? { json: { code: 1, stdout: "", stderr: "grep: no match" } }
        : {},
    );
    const ref = await provider.provision({ botId: "b", homePath: "/x" }, ctx);
    await expect(provider.prepare(ref, ctx)).rejects.toThrow("workspace is not mounted");
  });

  it("keeps the workspace import/export as no-ops", async () => {
    const { provider } = makeProvider(() => ({}));
    const exported = [];
    for await (const file of provider.exportWorkspace()) exported.push(file);
    expect(exported).toEqual([]);
    await expect(provider.importWorkspace()).resolves.toBe(undefined);
  });

  it("surfaces gone containers from keepAlive", async () => {
    const { provider } = makeProvider((request) =>
      request.path.endsWith("/ping") ? { status: 404 } : {},
    );
    const ref = await provider.provision({ botId: "b", homePath: "/x" }, ctx);
    await expect(provider.keepAlive!(ref)).rejects.toBeInstanceOf(CloudflareContainerGoneError);
  });

  it("returns desktop screen URLs pointing at the bridge proxy", async () => {
    const { provider } = makeProvider((request) => {
      if (request.path.endsWith("/agent/exec")) {
        return { json: { code: 0, stdout: "RAKAZO_DESKTOP=0:t0k3n", stderr: "" } };
      }
      return {};
    });
    const ref = await provider.provision({ botId: "b", homePath: "/x" }, ctx);
    const screen = await provider.connectScreen(
      ref,
      { view: "stream", interactive: false },
      { ...ctx, screenLeaseId: "lease" },
    );
    expect(screen.url).toContain(
      `https://bridge.test/v1/computers/${ref.providerRef}/screen/6100/vnc.html`,
    );
    expect(screen.url).toContain("token%3Dt0k3n");
  });

  it("stops and destroys through the bridge", async () => {
    const { provider, requests } = makeProvider(() => ({}));
    const ref = await provider.provision({ botId: "b", homePath: "/x" }, ctx);
    await provider.stop(ref, ctx);
    await provider.destroy(ref, ctx);
    expect(requests.map((request) => `${request.method} ${request.path}`)).toContain(
      `POST /v1/computers/${ref.providerRef}/stop`,
    );
    expect(requests.map((request) => `${request.method} ${request.path}`)).toContain(
      `DELETE /v1/computers/${ref.providerRef}`,
    );
  });
});

describe("cloudflare factory wiring", () => {
  it("boots as none without bridge configuration", () => {
    expect(createSandboxProvider("cloudflare", {}).describe().id).toBe("none");
    expect(createSandboxProvider("cloudflare", { cfBridgeUrl: "https://x" }).describe().id).toBe(
      "none",
    );
  });

  it("builds the provider and the emulator when configured", () => {
    expect(
      createSandboxProvider("cloudflare", {
        cfBridgeUrl: "https://bridge.test",
        cfBridgeToken: "tok",
      }).describe().id,
    ).toBe("cloudflare");
    expect(createSandboxProvider("cloudflare-emulator", {}).describe().id).toBe(
      "cloudflare-emulator",
    );
  });
});
