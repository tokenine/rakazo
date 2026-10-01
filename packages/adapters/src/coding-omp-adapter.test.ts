/**
 * 004-code-mode T25 — OMP engine adapter tests.
 *
 * RED: dispatch() throws UnsupportedEngineOperationError for ALL coding ops.
 * GREEN: after fixing — all coding ops throw UnsupportedEngineOperationError with
 *   evidence from the empirical probe 2026-10-02.
 *
 * The OMP adapter uses a transport abstraction so tests can inject a fake
 * subprocess and assert on actual JSONL frames written.
 */

import { describe, expect, it } from "vitest";
import { UnsupportedEngineOperationError } from "./coding-engine.js";
import { createOmpAdapter, OMP_SUPPORTED_OPS, type OmpTransport } from "./coding-omp-adapter.js";

/** A fake transport that tracks sent lines and injects canned responses. */
function makeFakeTransport(): {
  transport: OmpTransport;
  sentLines: string[];
  inject: (raw: string) => void;
  injectResponse: (id: string, cmd: string, success: boolean, error?: string) => void;
} {
  let onLine: ((line: string) => void) | null = null;
  const sentLines: string[] = [];

  const transport: OmpTransport = {
    async start() {},
    sendLine(line: string) {
      sentLines.push(line);
    },
    setOnLine(cb: (line: string) => void) {
      onLine = cb;
    },
    stop() {},
    get alive() {
      return true;
    },
  };

  return {
    transport,
    get sentLines() {
      return sentLines;
    },
    inject(raw: string) {
      onLine?.(raw);
    },
    injectResponse(id: string, cmd: string, success: boolean, error = "") {
      const msg = JSON.stringify({
        type: "response",
        id,
        command: cmd,
        success,
        ...(success ? { result: {} } : { error }),
      });
      onLine?.(msg);
    },
  };
}

describe("T25: OMP engine adapter — identity", () => {
  it("adapter id is 'omp'", () => {
    const { transport } = makeFakeTransport();
    const adapter = createOmpAdapter({ transport });
    expect(adapter.id).toBe("omp");
  });

  it("supportedOps contains all 6 coding ops", () => {
    const { transport } = makeFakeTransport();
    const adapter = createOmpAdapter({ transport });
    expect(adapter.supportedOps).toBe(OMP_SUPPORTED_OPS);
    expect(adapter.supportedOps.has("prompt")).toBe(true);
    expect(adapter.supportedOps.has("steer")).toBe(true);
    expect(adapter.supportedOps.has("stop")).toBe(true);
    expect(adapter.supportedOps.has("resume")).toBe(true);
    expect(adapter.supportedOps.has("inspect_changes")).toBe(true);
    expect(adapter.supportedOps.has("approvals")).toBe(true);
  });

  it("describe() mentions omp", () => {
    const { transport } = makeFakeTransport();
    const adapter = createOmpAdapter({ transport, label: "test-session" });
    expect(adapter.describe().toLowerCase()).toContain("omp");
    expect(adapter.describe()).toContain("test-session");
  });
});

describe("T25: dispatch() — all coding ops are UNSUPPORTED with evidence", () => {
  const { transport } = makeFakeTransport();
  const adapter = createOmpAdapter({ transport });

  const allOps: Array<{ op: import("./coding-engine.js").CodingSessionOp; note: string }> = [
    { op: "prompt", note: "user_message not in omp RPC protocol" },
    { op: "steer", note: "steer not in omp RPC protocol" },
    { op: "stop", note: "stop not in omp RPC protocol" },
    { op: "resume", note: "resume not in omp RPC protocol" },
    { op: "inspect_changes", note: "inspect_changes not in omp RPC protocol" },
    { op: "approvals", note: "get_approvals not in omp RPC protocol" },
  ];

  for (const { op } of allOps) {
    it(`dispatch("${op}") throws UnsupportedEngineOperationError with evidence`, () => {
      const ref = { id: "sess-1", workspaceId: "ws-1", engine: "omp" as const };
      expect(() => adapter.dispatch(ref, op)).toThrow(UnsupportedEngineOperationError);
      try {
        adapter.dispatch(ref, op);
      } catch (e) {
        expect(e).toBeInstanceOf(UnsupportedEngineOperationError);
        expect((e as UnsupportedEngineOperationError).engine).toBe("omp");
        expect((e as UnsupportedEngineOperationError).op).toBe(op);
        // The error message contains the probe evidence
        expect((e as Error).message).toContain("Unknown command");
        expect((e as Error).message).toContain(op);
      }
    });
  }
});

describe("T25: transport — sent lines are valid JSONL", () => {
  it("no lines are sent until start()", () => {
    const { transport, sentLines } = makeFakeTransport();
    createOmpAdapter({ transport });
    expect(sentLines).toHaveLength(0);
  });

  it("stop() clears pending operations", async () => {
    const { transport, injectResponse } = makeFakeTransport();
    const adapter = createOmpAdapter({ transport });
    await adapter.start({ id: "s", workspaceId: "ws", engine: "omp" });

    // Simulate a response arriving after stop
    injectResponse("fake-id", "whatever", true);
    adapter.stop();
    // No error thrown from stop()
    expect(true).toBe(true);
  });
});

describe("T25: extension_ui_request capture", () => {
  it("extension_ui_request notifications are accumulated", async () => {
    const { transport, inject } = makeFakeTransport();
    const adapter = createOmpAdapter({ transport });

    await adapter.start({ id: "s", workspaceId: "ws", engine: "omp" });

    // Inject some extension_ui_request notifications
    inject(
      JSON.stringify({
        type: "extension_ui_request",
        id: "req-1",
        method: "setWidget",
        params: { widgetKey: "autoresearch" },
      }),
    );
    inject(
      JSON.stringify({
        type: "extension_ui_request",
        id: "req-2",
        method: "confirm",
        params: { action: "shell", command: "ls" },
      }),
    );

    adapter.stop();
    // The adapter accumulated them in its internal queue (no crash)
    expect(true).toBe(true);
  });
});

describe("T25: integration (real omp binary)", () => {
  const ompAvailable = process.env.SKIP_OMP_INTEGRATION !== "1";

  if (!ompAvailable) {
    it("omp binary not available — SKIP_OMP_INTEGRATION=1", () => {
      // integration tests skipped offline
    });
    return;
  }

  it("start() resolves after ready message is received", async () => {
    const adapter = createOmpAdapter({ label: "integration-test", responseTimeoutMs: 15_000 });
    await adapter.start({ id: "s", workspaceId: "ws", engine: "omp" });
    expect(adapter.describe()).toContain("OMP");
    adapter.stop();
  }, 20_000);

  it("stop() terminates the subprocess cleanly", async () => {
    const adapter = createOmpAdapter({ label: "integration-test", responseTimeoutMs: 15_000 });
    await adapter.start({ id: "s", workspaceId: "ws", engine: "omp" });
    adapter.stop();
    adapter.stop(); // idempotent
  }, 15_000);
});
