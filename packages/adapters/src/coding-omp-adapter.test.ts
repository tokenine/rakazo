/**
 * 004-code-mode T25 — OMP RPC adapter tests (V1(omp), V2(omp)).
 *
 * Tests the CodingEngineAdapter interface for the "omp" engine.
 * MockOmpRpcSession extends the real class to intercept method calls
 * without spawning subprocesses.
 *
 * Protocol findings from T24 experiment (grill addendum):
 * - ready first, then id-correlated responses
 * - tool_execution_end is the ONLY trusted verification source
 * - extension_ui_request select + extension_ui_response round-trip
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsupportedEngineOperationError } from "./coding-engine.js";
import {
  createCodingOmpAdapter,
  OmpRpcSession,
  type CodingOmpAdapterDeps,
} from "./coding-omp-adapter.js";

// ---------------------------------------------------------------------------
// Mock OmpRpcSession — extends real class to intercept method calls
// ---------------------------------------------------------------------------

class MockOmpRpcSession extends OmpRpcSession {
  static mockPrompt = vi.fn().mockResolvedValue({
    sessionId: "mock-session",
    isTerminal: true,
  });
  static mockSteer = vi.fn().mockResolvedValue({
    runId: "mock-session",
    steered: true,
  });
  static mockStop = vi.fn().mockResolvedValue({ stopped: true });
  static mockResume = vi.fn().mockResolvedValue({ resumed: true });
  static mockInspectChanges = vi.fn().mockResolvedValue({
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    toolResults: [],
  });
  static mockGetPendingApprovals = vi.fn().mockResolvedValue({
    pending: [{ id: "select-1", method: "select", title: "Allow tool: bash", options: ["Approve", "Deny"] }],
  });
  static mockApproveTool = vi.fn().mockResolvedValue(undefined);
  static mockStart = vi.fn().mockResolvedValue(undefined);
  override prompt(text: string) {
    return MockOmpRpcSession.mockPrompt(text);
  }

  override steer(text: string) {
    return MockOmpRpcSession.mockSteer(text);
  }

  override stop() {
    return MockOmpRpcSession.mockStop();
  }

  override resume() {
    return MockOmpRpcSession.mockResume();
  }

  override inspectChanges() {
    return MockOmpRpcSession.mockInspectChanges();
  }

  override getPendingApprovals() {
    return MockOmpRpcSession.mockGetPendingApprovals();
  }

  override approveTool(toolId: string, approval: "Approve" | "Deny") {
    if (approval !== "Approve" && approval !== "Deny") {
      throw new Error(`Approval must be "Approve" or "Deny", got ${JSON.stringify(approval)}`);
    }
    return MockOmpRpcSession.mockApproveTool(toolId, approval);
  }

  override start() {
    return MockOmpRpcSession.mockStart() as Promise<void>;
  }
}

// ---------------------------------------------------------------------------
// Fake deps — uses mock session factory
// ---------------------------------------------------------------------------

function makeFakeDeps(): CodingOmpAdapterDeps {
  return {
    sessionFactory: (_deps: CodingOmpAdapterDeps, sessionId: string) => new MockOmpRpcSession(_deps, sessionId),
    spawnOmp: vi.fn().mockResolvedValue({} as never),
    approveTool: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// V1(omp): protocol conformance via adapter interface
// ---------------------------------------------------------------------------

describe("OMP RPC adapter — V1(omp) protocol conformance", () => {
  it("implements CodingEngineAdapter with id 'omp'", () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);
    expect(adapter).toHaveProperty("id", "omp");
    expect(adapter).toHaveProperty("dispatch");
    expect(adapter).toHaveProperty("describe");
  });

  it("exposes all required CodingSessionOps plus approve", () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);
    const expected = ["prompt", "steer", "stop", "resume", "inspect_changes", "approvals"];
    expected.forEach((op) => {
      expect(adapter.supportedOps.has(op as never), `expected ${op}`).toBe(true);
    });
  });

  it("prompt calls sess.prompt with text from payload", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    const result = await adapter.dispatch(
      { id: "s1", workspaceId: "ws-1", engine: "omp" },
      "prompt",
      { text: "hello", messageId: "m1" },
    );

    expect(result).toHaveProperty("sessionId");
  });

  it("stop calls sess.stop and returns stopped:true", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    const result = await adapter.dispatch(
      { id: "s1", workspaceId: "ws-1", engine: "omp" },
      "stop",
      {},
    );

    expect(result).toHaveProperty("stopped", true);
  });

  it("resume calls sess.resume and returns resumed:true", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    const result = await adapter.dispatch(
      { id: "s1", workspaceId: "ws-1", engine: "omp" },
      "resume",
      {},
    );

    expect(result).toHaveProperty("resumed", true);
  });

  it("inspect_changes returns messages + toolResults", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    const result = await adapter.dispatch(
      { id: "s1", workspaceId: "ws-1", engine: "omp" },
      "inspect_changes",
      {},
    );

    expect(result).toHaveProperty("messages");
    expect(Array.isArray((result as { messages: unknown }).messages)).toBe(true);
  });

  it("steer calls sess.steer and returns steered:true", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    const result = await adapter.dispatch(
      { id: "s1", workspaceId: "ws-1", engine: "omp" },
      "steer",
      { text: "actually do X", messageId: "m1" },
    );

    expect(result).toHaveProperty("runId");
    expect(result).toHaveProperty("steered", true);
  });

  it("approvals returns pending array with select items", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    const result = await adapter.dispatch(
      { id: "s1", workspaceId: "ws-1", engine: "omp" },
      "approvals",
      {},
    );

    expect(result).toHaveProperty("pending");
    expect((result as { pending: unknown[] }).pending.length).toBeGreaterThan(0);
  });

  it("approve calls sess.approveTool with id and approval value", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    await adapter.dispatch(
      { id: "s1", workspaceId: "ws-1", engine: "omp" },
      "prompt",
      { text: "hello", messageId: "m1" },
    );

    const result = await adapter.dispatch(
      { id: "s1", workspaceId: "ws-1", engine: "omp" },
      "approve",
      { id: "select-1", value: "Approve" },
    );

    expect(result).toHaveProperty("approved", "Approve");
  });

  it("surfaces an unsupported op as UnsupportedEngineOperationError — never silent switch", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    await expect(
      (adapter as unknown as { dispatch: Function }).dispatch(
        { id: "s1", workspaceId: "ws-1", engine: "omp" },
        "nonexistent_op",
        {},
      ),
    ).rejects.toBeInstanceOf(UnsupportedEngineOperationError);
  });

  it("approve rejects non-Approve/Deny values", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    await expect(
      adapter.dispatch(
        { id: "s1", workspaceId: "ws-1", engine: "omp" },
        "approve",
        { id: "some-id", value: "Maybe" },
      ),
    ).rejects.toThrow(/approve|deny/i);
  });
});

// ---------------------------------------------------------------------------
// V2(omp): repo-to-PR integrity
// ---------------------------------------------------------------------------

describe("OMP adapter — V2(omp) repo-to-PR integrity", () => {
  it("inspect_changes exposes toolResults from tool_execution_end — the trusted verification source", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    const result = await adapter.dispatch(
      { id: "s1", workspaceId: "ws-1", engine: "omp" },
      "inspect_changes",
      {},
    );

    expect(result).toHaveProperty("toolResults");
    expect(Array.isArray((result as { toolResults: unknown }).toolResults)).toBe(true);
  });

  it("approve/deny is adapter-specific (not in CODING_SESSION_OPS) but dispatchable", () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    expect(adapter.supportedOps.has("approve" as never)).toBe(true);
  });

  it("approveTool delegates to deps.approveTool when no session is active", async () => {
    const deps = makeFakeDeps();
    const adapter = createCodingOmpAdapter(deps);

    await adapter.approveTool("tool-1", "Approve");

    expect(deps.approveTool).toHaveBeenCalledWith("tool-1", "Approve");
  });
});
