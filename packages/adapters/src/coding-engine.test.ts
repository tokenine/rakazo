import { describe, expect, it } from "vitest";
import {
  CODING_ENGINE_IDS,
  type CodingEngineAdapter,
  type CodingSessionOp,
  ContinuationRefusedError,
  createCodingSessionRef,
  createEngineRegistry,
  dispatchSessionOp,
  ENGINE_CHANGE_LABEL,
  EngineMismatchError,
  planContinuation,
  UnsupportedEngineOperationError,
} from "./coding-engine.js";

const allOps: CodingSessionOp[] = [
  "prompt",
  "steer",
  "stop",
  "resume",
  "inspect_changes",
  "approvals",
];

function fakeAdapter(
  id: "normal-pi" | "omp",
  supportedOps: CodingSessionOp[],
): CodingEngineAdapter {
  return { id, supportedOps: new Set(supportedOps), describe: () => `fake-${id}` };
}

function registryWithBothEngines() {
  return createEngineRegistry([fakeAdapter("normal-pi", allOps), fakeAdapter("omp", allOps)]);
}

describe("coding engine registry (T2, V1 groundwork)", () => {
  it("exposes exactly the two supported engine ids", () => {
    expect([...CODING_ENGINE_IDS].sort()).toEqual(["normal-pi", "omp"]);
  });

  it("creates a session ref bound to (workspaceId, engine) with the engine fixed", () => {
    const session = createCodingSessionRef({
      id: "session-1",
      workspaceId: "ws-1",
      engine: "normal-pi",
    });
    expect(session).toEqual({ id: "session-1", workspaceId: "ws-1", engine: "normal-pi" });
    expect(Object.isFrozen(session)).toBe(true);
  });

  it("refuses an unknown engine at session creation", () => {
    expect(() =>
      createCodingSessionRef({
        id: "session-1",
        workspaceId: "ws-1",
        // Engine ids are a closed set; anything else is refused, not coerced.
        engine: "zcode" as never,
      }),
    ).toThrow(/unknown coding engine/i);
  });

  it("the session ref has no engine mutation path (frozen; strict-mode write throws)", () => {
    const session = createCodingSessionRef({
      id: "session-1",
      workspaceId: "ws-1",
      engine: "normal-pi",
    });
    expect(() => {
      (session as { engine: string }).engine = "omp";
    }).toThrow(TypeError);
    expect(session.engine).toBe("normal-pi");
  });

  it("dispatches to the adapter registered for the session's engine", async () => {
    const registry = registryWithBothEngines();
    const session = createCodingSessionRef({
      id: "session-1",
      workspaceId: "ws-1",
      engine: "normal-pi",
    });
    const seen: string[] = [];
    const result = await dispatchSessionOp(registry, session, "prompt", async (adapter) => {
      seen.push(adapter.id);
      return "prompted";
    });
    expect(result).toBe("prompted");
    expect(seen).toEqual(["normal-pi"]);
  });

  it("surfaces an unsupported op as a typed error naming engine and op — never a silent switch", async () => {
    const registry = createEngineRegistry([fakeAdapter("normal-pi", ["prompt", "stop"])]);
    registry.register(fakeAdapter("omp", allOps));
    const session = createCodingSessionRef({
      id: "session-1",
      workspaceId: "ws-1",
      engine: "normal-pi",
    });
    // Only the omp adapter supports steer; the pi session must refuse, not switch engines.
    const error = await dispatchSessionOp(registry, session, "steer", async () => "steered").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(UnsupportedEngineOperationError);
    expect((error as UnsupportedEngineOperationError).engine).toBe("normal-pi");
    expect((error as UnsupportedEngineOperationError).op).toBe("steer");
    expect((error as Error).message).toMatch(/steer/);
    expect((error as Error).message).toMatch(/normal-pi/);
  });

  it("refuses dispatch for an engine with no registered adapter (omp before S4) explicitly", async () => {
    const registry = createEngineRegistry([fakeAdapter("normal-pi", allOps)]);
    const session = createCodingSessionRef({
      id: "session-1",
      workspaceId: "ws-1",
      engine: "omp",
    });
    const error = await dispatchSessionOp(registry, session, "prompt", async () => "ran").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(EngineMismatchError);
    expect((error as Error).message).toMatch(/omp/);
  });

  it("dispatch is exact-engine: an override engine different from the session engine is refused", async () => {
    const registry = registryWithBothEngines();
    const session = createCodingSessionRef({
      id: "session-1",
      workspaceId: "ws-1",
      engine: "normal-pi",
    });
    const error = await dispatchSessionOp(
      registry,
      session,
      "prompt",
      async () => "x",
      "omp",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EngineMismatchError);
  });
});

describe("engine continuation rules (V15 S1 portion)", () => {
  const original = createCodingSessionRef({
    id: "session-1",
    workspaceId: "ws-1",
    engine: "normal-pi",
  });

  function plan(input: Omit<Parameters<typeof planContinuation>[0], "registry">) {
    return planContinuation({ ...input, registry: registryWithBothEngines() });
  }

  it("refuses continuation while the original run is still active (stop first)", () => {
    expect(() =>
      plan({
        originalSession: original,
        originalRunStopped: false,
        targetEngine: "normal-pi",
      }),
    ).toThrow(ContinuationRefusedError);
    try {
      plan({
        originalSession: original,
        originalRunStopped: false,
        targetEngine: "normal-pi",
      });
    } catch (error) {
      expect((error as Error).message).toMatch(/stop/i);
    }
  });

  it("allows an explicit same-engine continuation with an optional handoff summary", () => {
    const continuation = plan({
      originalSession: original,
      originalRunStopped: true,
      targetEngine: "normal-pi",
      handoffSummary: "WIP: auth refactor, tests red",
    });
    expect(continuation.engineChanged).toBe(false);
    expect(continuation.nextSession.workspaceId).toBe("ws-1");
    expect(continuation.nextSession.engine).toBe("normal-pi");
    expect(continuation.nextSession.id).not.toBe(original.id);
    expect(continuation.handoffSummary).toBe("WIP: auth refactor, tests red");
  });

  it("refuses an unlabelled engine change", () => {
    expect(() =>
      plan({
        originalSession: original,
        originalRunStopped: true,
        targetEngine: "omp",
        handoffSummary: "handing off",
      }),
    ).toThrow(ContinuationRefusedError);
    try {
      plan({
        originalSession: original,
        originalRunStopped: true,
        targetEngine: "omp",
        handoffSummary: "handing off",
      });
    } catch (error) {
      expect((error as Error).message).toMatch(/label/i);
    }
  });

  it("refuses a labelled engine change without a handoff summary", () => {
    expect(() =>
      plan({
        originalSession: original,
        originalRunStopped: true,
        targetEngine: "omp",
        label: ENGINE_CHANGE_LABEL,
      }),
    ).toThrow(ContinuationRefusedError);
    try {
      plan({
        originalSession: original,
        originalRunStopped: true,
        targetEngine: "omp",
        label: ENGINE_CHANGE_LABEL,
      });
    } catch (error) {
      expect((error as Error).message).toMatch(/handoff/i);
    }
  });

  it("refuses a label that is not the engine-change label on an engine change", () => {
    expect(() =>
      plan({
        originalSession: original,
        originalRunStopped: true,
        targetEngine: "omp",
        label: "routine-restart",
        handoffSummary: "state",
      }),
    ).toThrow(ContinuationRefusedError);
  });

  it("accepts an engine change only when labelled and carrying the handoff summary", () => {
    const continuation = plan({
      originalSession: original,
      originalRunStopped: true,
      targetEngine: "omp",
      label: ENGINE_CHANGE_LABEL,
      handoffSummary: "auth refactor state",
    });
    expect(continuation.engineChanged).toBe(true);
    expect(continuation.label).toBe(ENGINE_CHANGE_LABEL);
    expect(continuation.nextSession.engine).toBe("omp");
    expect(continuation.nextSession.workspaceId).toBe("ws-1");
  });

  it("refuses an engine change to an engine with no registered adapter", () => {
    expect(() =>
      planContinuation({
        originalSession: original,
        originalRunStopped: true,
        targetEngine: "omp",
        label: ENGINE_CHANGE_LABEL,
        handoffSummary: "state",
        registry: createEngineRegistry([fakeAdapter("normal-pi", allOps)]),
      }),
    ).toThrow(ContinuationRefusedError);
  });

  it("never translates engine-internal state: the plan carries only the handoff text plus labels", () => {
    const continuation = plan({
      originalSession: original,
      originalRunStopped: true,
      targetEngine: "omp",
      label: ENGINE_CHANGE_LABEL,
      handoffSummary: "state",
    });
    expect(Object.keys(continuation).sort()).toEqual([
      "engineChanged",
      "handoffSummary",
      "label",
      "nextSession",
    ]);
  });

  it("preserves the original session untouched after planning a continuation", () => {
    plan({
      originalSession: original,
      originalRunStopped: true,
      targetEngine: "omp",
      label: ENGINE_CHANGE_LABEL,
      handoffSummary: "state",
    });
    expect(original).toEqual({ id: "session-1", workspaceId: "ws-1", engine: "normal-pi" });
  });
});
