/**
 * 004-code-mode T25 — OMP engine adapter tests.
 *
 * RED: adapter smoke tests compile but dispatch() throws
 *   UnsupportedEngineOperationError because no process is running.
 * GREEN: dispatch() correctly manages the OMP child process lifecycle.
 *
 * Integration tests (real omp binary) are gated with SKIP_OMP_INTEGRATION.
 */

import { describe, expect, it } from "vitest";
import { createCodingSessionRef } from "./coding-engine.js";
import { createOmpAdapter, OMP_SUPPORTED_OPS } from "./coding-omp-adapter.js";

const FAKE_SESSION_REF = createCodingSessionRef({
  id: "session-omp-test",
  workspaceId: "ws-omp",
  engine: "omp",
});

// ─── Unit tests ─────────────────────────────────────────────────────────────

describe("T25: OMP engine adapter", () => {
  it("has correct id and exposes all required ops", () => {
    const adapter = createOmpAdapter({ label: "test" });
    expect(adapter.id).toBe("omp");
    expect(adapter.supportedOps).toEqual(OMP_SUPPORTED_OPS);
    for (const op of [
      "prompt",
      "steer",
      "stop",
      "resume",
      "inspect_changes",
      "approvals",
    ] as const) {
      expect(adapter.supportedOps.has(op)).toBe(true);
    }
  });

  it("stop() is safe before start() — no-op, no error", () => {
    const adapter = createOmpAdapter({ label: "test" });
    expect(() => adapter.stop()).not.toThrow();
  });

  it("describe() returns a string containing the adapter id and label", () => {
    const adapter = createOmpAdapter({ label: "my-session" });
    const desc = adapter.describe();
    expect(typeof desc).toBe("string");
    expect(desc.toLowerCase()).toContain("omp");
    expect(desc).toContain("my-session");
  });

  it("stop() after start() terminates the process (skipped offline — requires omp binary)", async () => {
    if (process.env.SKIP_OMP_INTEGRATION === "1") return;
    const adapter = createOmpAdapter({ label: "test", responseTimeoutMs: 5_000 });
    await adapter.start(FAKE_SESSION_REF);
    expect(() => adapter.stop()).not.toThrow();
    adapter.stop(); // idempotent
  }, 10_000);
});

describe("T25: OMP dispatch integration (skipped offline — requires omp binary)", () => {
  if (process.env.SKIP_OMP_INTEGRATION === "1") {
    it("omp binary not available — SKIP_OMP_INTEGRATION=1", () => {
      /* noop */
    });
    return;
  }

  it("start() resolves after the OMP ready message is received", async () => {
    const adapter = createOmpAdapter({ label: "integration-test", responseTimeoutMs: 10_000 });
    await adapter.start(FAKE_SESSION_REF);
    expect(adapter.describe().toLowerCase()).toContain("omp");
    adapter.stop();
  }, 15_000);

  it("stop() terminates the subprocess cleanly", async () => {
    const adapter = createOmpAdapter({ label: "integration-test", responseTimeoutMs: 10_000 });
    await adapter.start(FAKE_SESSION_REF);
    adapter.stop();
    adapter.stop(); // idempotent
  }, 10_000);
});
