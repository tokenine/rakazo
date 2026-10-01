/**
 * 004-code-mode T2 — coding engine registry + dispatch.
 *
 * Two engines exist (R2): "normal-pi" (S1, riding the existing run machinery)
 * and "omp" (S4, gated on the Q1/G10 RPC experiment). The engine is fixed at
 * session creation: session refs are frozen, dispatch is exact-engine, and an
 * unsupported operation is surfaced as a typed error — never a silent engine
 * switch.
 */

export const CODING_ENGINE_IDS = ["normal-pi", "omp"] as const;

export type CodingEngineId = (typeof CODING_ENGINE_IDS)[number];

export const ENGINE_CHANGE_LABEL = "engine-change";

/** The ops both engines must expose per R2; per-engine support stays explicit. */
export const CODING_SESSION_OPS = [
  "prompt",
  "steer",
  "stop",
  "resume",
  "inspect_changes",
  "approvals",
] as const;

export type CodingSessionOp = (typeof CODING_SESSION_OPS)[number];

export function isCodingEngineId(value: unknown): value is CodingEngineId {
  return typeof value === "string" && (CODING_ENGINE_IDS as readonly string[]).includes(value);
}

export class UnsupportedEngineOperationError extends Error {
  readonly engine: CodingEngineId;
  readonly op: CodingSessionOp | string;

  constructor(engine: CodingEngineId, op: CodingSessionOp | string) {
    super(
      `Coding engine "${engine}" does not support operation "${op}". ` +
        `No fallback engine was used; surface the limitation instead of switching engines.`,
    );
    this.name = "UnsupportedEngineOperationError";
    this.engine = engine;
    this.op = op;
  }
}

export class EngineMismatchError extends Error {
  readonly sessionEngine: CodingEngineId;
  readonly requestedEngine?: CodingEngineId;

  constructor(sessionEngine: CodingEngineId, requestedEngine?: CodingEngineId) {
    super(
      requestedEngine
        ? `Session engine is "${sessionEngine}" but "${requestedEngine}" was requested. ` +
            `Mid-session engine changes are impossible; use an explicit labelled continuation.`
        : `No adapter is registered for coding engine "${sessionEngine}". ` +
            `Refusing instead of switching engines.`,
    );
    this.name = "EngineMismatchError";
    this.sessionEngine = sessionEngine;
    this.requestedEngine = requestedEngine;
  }
}

export interface CodingSessionRef {
  readonly id: string;
  readonly workspaceId: string;
  readonly engine: CodingEngineId;
}

export interface CodingEngineAdapter {
  readonly id: CodingEngineId;
  readonly supportedOps: ReadonlySet<CodingSessionOp>;
  describe(): string;
}

/** Creates the immutable (workspace, engine) binding for a session. */
export function createCodingSessionRef(input: {
  id: string;
  workspaceId: string;
  engine: CodingEngineId;
}): CodingSessionRef {
  if (!isCodingEngineId(input.engine)) {
    throw new Error(
      `Unknown coding engine ${JSON.stringify(input.engine)}. Supported: ${CODING_ENGINE_IDS.join(", ")}.`,
    );
  }
  return Object.freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    engine: input.engine,
  });
}

export class EngineRegistry {
  private readonly adapters = new Map<CodingEngineId, CodingEngineAdapter>();

  constructor(adapters: readonly CodingEngineAdapter[]) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: CodingEngineAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(engine: CodingEngineId): CodingEngineAdapter | undefined {
    return this.adapters.get(engine);
  }

  require(engine: CodingEngineId): CodingEngineAdapter {
    const adapter = this.adapters.get(engine);
    if (!adapter) throw new EngineMismatchError(engine);
    return adapter;
  }

  ids(): CodingEngineId[] {
    return [...this.adapters.keys()];
  }
}

export function createEngineRegistry(adapters: readonly CodingEngineAdapter[]): EngineRegistry {
  return new EngineRegistry(adapters);
}

/**
 * Runs an op through the adapter registered for the session's engine.
 * Exact-engine only: an explicit override must match the session engine, and
 * an unsupported op refuses with a typed error instead of switching engines.
 */
export async function dispatchSessionOp<TResult>(
  registry: EngineRegistry,
  session: CodingSessionRef,
  op: CodingSessionOp,
  run: (adapter: CodingEngineAdapter) => Promise<TResult>,
  requestedEngine?: CodingEngineId,
): Promise<TResult> {
  if (requestedEngine && requestedEngine !== session.engine) {
    throw new EngineMismatchError(session.engine, requestedEngine);
  }
  const adapter = registry.require(session.engine);
  if (!adapter.supportedOps.has(op)) {
    throw new UnsupportedEngineOperationError(session.engine, op);
  }
  return run(adapter);
}

export interface ContinuationPlan {
  nextSession: CodingSessionRef;
  engineChanged: boolean;
  /** Present (as ENGINE_CHANGE_LABEL) only when the continuation changed engines. */
  label?: typeof ENGINE_CHANGE_LABEL;
  handoffSummary: string;
}

export type ContinuationInput = {
  originalSession: CodingSessionRef;
  /** R8: the original run must stop before the workspace control transfers. */
  originalRunStopped: boolean;
  targetEngine: CodingEngineId;
  registry?: EngineRegistry;
  handoffSummary?: string;
  label?: string;
};

/**
 * V15 (S1 portion): explicit continuation RULES at session level.
 * - The original run must be stopped first.
 * - An engine change is allowed only when labelled AND carrying a handoff summary.
 * - The new session keeps the same workspace; the original session/history is
 *   untouched, and no engine-internal state crosses — only the handoff text.
 */
export function planContinuation(input: ContinuationInput): ContinuationPlan {
  const refusal = (reason: string): never => {
    throw new ContinuationRefusedError(reason);
  };
  if (!input.originalRunStopped) {
    refusal(
      "The original run must stop before continuation; stop it first, then continue explicitly.",
    );
  }
  if (!isCodingEngineId(input.targetEngine)) {
    refusal(`Unknown target coding engine ${JSON.stringify(input.targetEngine)}.`);
  }
  const engineChanged = input.targetEngine !== input.originalSession.engine;
  let label: typeof ENGINE_CHANGE_LABEL | undefined;
  if (engineChanged) {
    if (input.label !== ENGINE_CHANGE_LABEL) {
      refusal(
        `An engine change continuation requires the "${ENGINE_CHANGE_LABEL}" label; ` +
          `engine changes are never silent.`,
      );
    }
    if (!input.handoffSummary?.trim()) {
      refusal(
        "An engine-change continuation must carry a handoff summary; engine-internal runtime " +
          "state is never translated across engines.",
      );
    }
    if (input.registry && !input.registry.get(input.targetEngine)) {
      refusal(
        `Target coding engine "${input.targetEngine}" has no registered adapter; ` +
          `continuation to it is not available.`,
      );
    }
    label = ENGINE_CHANGE_LABEL;
  }
  return {
    nextSession: createCodingSessionRef({
      id: `${input.originalSession.id}-continuation`,
      workspaceId: input.originalSession.workspaceId,
      engine: input.targetEngine,
    }),
    engineChanged,
    ...(label ? { label } : {}),
    handoffSummary: input.handoffSummary?.trim() ?? "",
  };
}

export class ContinuationRefusedError extends Error {
  constructor(reason: string) {
    super(`Continuation refused: ${reason}`);
    this.name = "ContinuationRefusedError";
  }
}
