import { describe, expect, it } from "vitest";
import { waitForCliCallback } from "./login-flow.js";

const closeups: (() => void)[] = [];
function startListener(state: string, timeoutMs = 5_000) {
  let port = 0;
  let pendingResolve: (result: ReturnType<typeof waitForResult>) => void;
  type WaitForResult = Awaited<ReturnType<typeof waitForCliCallback>>;
  const pending = new Promise<WaitForResult>((resolve) => {
    pendingResolve = resolve;
  });
  const listening = new Promise<number>((resolve) => {
    waitForCliCallback({
      state,
      timeoutMs,
      onListening: (actual) => {
        port = actual;
        resolve(actual);
      },
    }).then((result) => pendingResolve(result));
  });
  return { listening, pending };
}

function post(port: number, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/callback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("waitForCliCallback", () => {
  it("resolves with the token when the page posts a matching state", async () => {
    const flow = startListener("teststate123");
    const port = await flow.listening;
    const res = await post(port, { state: "teststate123", token: "rakazo_cli_abc" });
    expect(res.status).toBe(200);
    await expect(flow.pending).resolves.toEqual({ token: "rakazo_cli_abc" });
  });

  it("resolves with denied when the page posts a denial", async () => {
    const flow = startListener("denytest123");
    const port = await flow.listening;
    await post(port, { state: "denytest123", denied: true });
    await expect(flow.pending).resolves.toEqual({ denied: true });
  });

  it("ignores mismatched states and keeps waiting", async () => {
    const flow = startListener("goodstate");
    const port = await flow.listening;
    const bad = await post(port, { state: "evil", token: "rakazo_cli_evil" });
    expect(bad.status).toBe(403);
    const good = await post(port, { state: "goodstate", token: "rakazo_cli_ok" });
    expect(good.status).toBe(200);
    await expect(flow.pending).resolves.toEqual({ token: "rakazo_cli_ok" });
  });

  it("times out with no callback", async () => {
    const flow = startListener("quiet", 50);
    await flow.listening;
    await expect(flow.pending).resolves.toEqual({ timeout: true });
  });
});
