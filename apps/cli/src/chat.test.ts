import { describe, expect, it } from "vitest";
import { chat } from "./chat.js";

const SPACE = "space_1";
const BOT = "bot_1";

function rpc(method: string, result: unknown): { method: string; result: unknown } {
  return { method, result };
}

/** Builds a fake fetch that answers each call in order, keyed by RPC method. */
function scriptedFetch(steps: { method: string; result: unknown }[]) {
  let call = 0;
  return async (
    url: string | URL,
    init?: { body: string },
  ): Promise<{ ok: boolean; status: number; json: () => Promise<{ json?: unknown }> }> => {
    // Route by URL path (e.g. /rpc/threads/send), like the server does.
    const segments = new URL(String(url)).pathname
      .split("/")
      .filter(Boolean)
      .slice(1)
      .map(decodeURIComponent);
    const method = segments.join(".");
    const step = steps[Math.min(call, steps.length - 1)]!;
    call += 1;
    if (step.method !== method) {
      throw new Error(`expected ${step.method}, got ${method}`);
    }
    return { ok: true, status: 200, json: async () => ({ json: step.result }) };
  };
}

function snapshot(runStatus: string, messages: unknown[]) {
  return {
    threadId: "thread_1",
    cursor: 2,
    messages,
    olderCursor: null,
    botId: BOT,
    run: { id: "run_1", botId: BOT, threadId: "thread_1", taskId: "task_1", status: runStatus },
  };
}

describe("chat", () => {
  it("sends the message and returns the bot's reply text", async () => {
    const fetchImpl = scriptedFetch([
      rpc("threads.send", { taskId: "task_1", runId: "run_1", seq: 1 }),
      rpc(
        "threads.get",
        snapshot("running", [
          { id: "m1", seq: 1, role: "user", blocks: [{ kind: "text", text: "hi" }] },
        ]),
      ),
      rpc(
        "threads.get",
        snapshot("completed", [
          { id: "m1", seq: 1, role: "user", blocks: [{ kind: "text", text: "hi" }] },
          {
            id: "m2",
            seq: 2,
            role: "bot",
            blocks: [{ kind: "text", text: "hello back" }],
          },
        ]),
      ),
    ]);

    const result = await chat({
      botId: BOT,
      message: "hi",
      baseUrl: "http://x/rpc",
      spaceId: SPACE,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      pollMs: 0,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        reply: "hello back",
        threadId: "thread_1",
        runStatus: "completed",
      });
    }
  });

  it("completes when the finished run has vanished from the snapshot", async () => {
    const fetchImpl = scriptedFetch([
      rpc("threads.send", { taskId: "task_1", runId: "run_1", seq: 1 }),
      rpc("threads.get", {
        threadId: "thread_1",
        cursor: 2,
        messages: [
          { id: "m1", seq: 1, role: "user", blocks: [{ kind: "text", text: "hi" }] },
          { id: "m2", seq: 2, role: "bot", blocks: [{ kind: "text", text: "all done" }] },
        ],
        olderCursor: null,
        botId: BOT,
        run: null,
      }),
    ]);

    const result = await chat({
      botId: BOT,
      message: "hi",
      baseUrl: "http://x/rpc",
      spaceId: SPACE,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      pollMs: 0,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ reply: "all done", runStatus: "completed" });
    }
  });

  it("times out with a structured error when the bot never answers", async () => {
    const fetchImpl = scriptedFetch([
      rpc("threads.send", { taskId: "task_1", runId: "run_1", seq: 1 }),
      rpc(
        "threads.get",
        snapshot("running", [
          { id: "m1", seq: 1, role: "user", blocks: [{ kind: "text", text: "hi" }] },
        ]),
      ),
    ]);

    const result = await chat({
      botId: BOT,
      message: "hi",
      baseUrl: "http://x/rpc",
      spaceId: SPACE,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      pollMs: 0,
      timeoutMs: 20,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TIMEOUT");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("surfaces waiting_input and pending approvals instead of a bare timeout", async () => {
    const fetchImpl = scriptedFetch([
      rpc("threads.send", { taskId: "task_1", runId: "run_1", seq: 1 }),
      rpc(
        "threads.get",
        snapshot("waiting_input", [
          { id: "m1", seq: 1, role: "user", blocks: [{ kind: "text", text: "hi" }] },
          {
            id: "m2",
            seq: 2,
            role: "bot",
            blocks: [{ kind: "ask", text: "Which database?", actions: [] }],
          },
        ]),
      ),
    ]);

    const result = await chat({
      botId: BOT,
      message: "hi",
      baseUrl: "http://x/rpc",
      spaceId: SPACE,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      pollMs: 0,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.runStatus).toBe("waiting_input");
      expect(result.data.reply).toContain("Which database?");
    }
  });

  it("maps a failed run to a structured non-retryable error", async () => {
    const fetchImpl = scriptedFetch([
      rpc("threads.send", { taskId: "task_1", runId: "run_1", seq: 1 }),
      rpc(
        "threads.get",
        snapshot("failed", [
          { id: "m1", seq: 1, role: "user", blocks: [{ kind: "text", text: "hi" }] },
        ]),
      ),
    ]);

    const result = await chat({
      botId: BOT,
      message: "hi",
      baseUrl: "http://x/rpc",
      spaceId: SPACE,
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      pollMs: 0,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("GENERAL");
      expect(result.error.retryable).toBe(false);
    }
  });
});
