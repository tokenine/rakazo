/**
 * 004-code-mode T1 — coding session service (Q3).
 *
 * A durable session bound to (workspaceId, engine) at creation. The
 * per-workspace lease table makes a workspace single-owner: a second run
 * cannot attach while the lease is held (never last-writer-wins). Expired
 * leases are taken over with a bumped fence, mirroring the existing
 * run/computer lease pattern. Rows live in Postgres, so the binding survives
 * restarts; reattach never changes the engine.
 *
 * Fix-round hardening (checker MED-2/3/4, LOW-1/2):
 * - MED-3: takeover of an expired lease is ONE conditional update (expiry +
 *   fence) — of two concurrent attaches exactly one wins; the loser gets an
 *   explicit WorkspaceBusyError instead of both silently winning.
 * - LOW-2: every lease mutation is conditioned on the fence read moments
 *   earlier (updateMany where fence = expected), including releases.
 * - MED-2: touchCodingSessionLease revalidates ownership and slides the
 *   expiry on session activity (prompt/steer/stop/resume); a lost or expired
 *   lease refuses with LeaseLostError and is never silently re-taken.
 * - MED-4: continueCodingSession is one transaction (stop → release → create
 *   → provenance) and derives "original stopped" from the row itself.
 * - LOW-1: a requestedEngine that differs from the durable binding is a typed
 *   EngineMismatchError.
 */

import type { PrismaClient } from "@rakazo/db";
import {
  type CodingSessionRef,
  createCodingSessionRef,
  EngineMismatchError,
  type EngineRegistry,
  isCodingEngineId,
  planContinuation,
} from "./coding-engine.js";

// continueCodingSession surfaces these rules; re-exported for consumers.
export { ContinuationRefusedError, EngineMismatchError } from "./coding-engine.js";

export const DEFAULT_LEASE_TTL_MS = 10 * 60_000;

export class WorkspaceBusyError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string, detail: string) {
    super(`Workspace "${workspaceId}" is busy: ${detail}`);
    this.name = "WorkspaceBusyError";
    this.workspaceId = workspaceId;
  }
}

export class CodingSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Coding session "${sessionId}" not found`);
    this.name = "CodingSessionNotFoundError";
  }
}

/**
 * MED-2 (fix round): raised by activity touchpoints (prompt/steer/stop/resume)
 * when the session no longer owns its workspace lease. A lost lease is never
 * healed silently — re-taking an expired lease is an explicit
 * loadCodingSession decision, not a side effect of continuing work.
 */
export class LeaseLostError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string, detail: string) {
    super(`Coding session "${sessionId}" no longer holds its workspace lease: ${detail}`);
    this.name = "LeaseLostError";
    this.sessionId = sessionId;
  }
}

/** The prisma surface this service uses (also the fake-double contract). */
export interface SessionServiceStore {
  sessions: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
}

/** The lease-relevant clock the service (and the adapter) pass around. */
export interface SessionLeaseClock {
  now: () => Date;
  leaseTtlMs: number;
}

/** The subset of a prisma transaction client this service touches. */
type SessionStoreTx = Pick<PrismaClient, "codingSession" | "codingWorkspaceLease">;

export interface SessionServiceDeps extends SessionLeaseClock {
  prisma: PrismaClient;
  /** When present, continuation engine changes also require a registered adapter. */
  registry?: EngineRegistry;
  /**
   * Home store for computing the workspace dirty-set on crash reconciliation.
   * When absent, reconcileCrash returns an empty dirty-set (offline/detached path).
   */
  homeStore?: import("@rakazo/adapter-kit").AgentHomeStore;
}

export function createSessionServiceDeps(input: {
  prisma: PrismaClient;
  registry?: EngineRegistry;
  now?: () => Date;
  leaseTtlMs?: number;
  homeStore?: import("@rakazo/adapter-kit").AgentHomeStore;
}): SessionServiceDeps {
  return {
    prisma: input.prisma,
    ...(input.registry ? { registry: input.registry } : {}),
    now: input.now ?? (() => new Date()),
    leaseTtlMs: input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
    ...(input.homeStore ? { homeStore: input.homeStore } : {}),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    Boolean(error) && typeof error === "object" && (error as { code?: string }).code === "P2002"
  );
}

function leaseExpiry(clock: SessionLeaseClock, at: Date): Date {
  return new Date(at.getTime() + clock.leaseTtlMs);
}

function leaseExpired(lease: { expiresAt: Date }, at: Date): boolean {
  return lease.expiresAt.getTime() <= at.getTime();
}

function sessionView(row: Record<string, unknown>): CodingSessionRef & { status: string } {
  if (!isCodingEngineId(row.engine)) {
    throw new Error(`Coding session row has unknown engine ${JSON.stringify(row.engine)}`);
  }
  return Object.freeze({
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    engine: row.engine,
    status: row.status as string,
  });
}

/**
 * Session + lease creation against an existing transaction. Shared by
 * createCodingSession (own transaction) and continueCodingSession (MED-4: the
 * whole continuation is a single transaction). The engine must be validated by
 * the caller. On a lease create race, the takeover is a single conditional
 * update (expired + fence) so exactly one racer can claim the workspace
 * (MED-3/LOW-2); the loser gets an explicit WorkspaceBusyError and, running
 * inside the caller's transaction, leaves no rows behind.
 */
async function createCodingSessionInTx(
  tx: SessionStoreTx,
  clock: SessionLeaseClock,
  input: {
    workspaceId: string;
    engine: CodingSessionRef["engine"];
    spaceId: string;
    userId: string;
    botId: string;
    threadId?: string;
    title?: string;
    owner?: string;
  },
): Promise<string> {
  const now = clock.now();
  const expiresAt = leaseExpiry(clock, now);
  const owner = input.owner ?? input.userId;
  try {
    await tx.codingWorkspaceLease.create({
      data: {
        workspaceId: input.workspaceId,
        sessionId: "pending",
        owner,
        fence: 1,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lease row exists: take it over only when expired, conditioned on the
    // fence we just read; refuse when busy — never last-writer-wins.
    const existing = await tx.codingWorkspaceLease.findUnique({
      where: { workspaceId: input.workspaceId },
    });
    if (!existing) {
      throw new WorkspaceBusyError(input.workspaceId, "lease row vanished while claiming");
    }
    if (!leaseExpired(existing, now)) {
      throw new WorkspaceBusyError(
        input.workspaceId,
        "another coding session holds the lease; never last-writer-wins on an active workspace",
      );
    }
    const taken = await tx.codingWorkspaceLease.updateMany({
      where: { workspaceId: input.workspaceId, fence: existing.fence, expiresAt: { lte: now } },
      data: { owner, fence: { increment: 1 }, expiresAt, updatedAt: now },
    });
    if (taken.count !== 1) {
      throw new WorkspaceBusyError(
        input.workspaceId,
        "another session claimed the expired lease concurrently",
      );
    }
  }
  const session = await tx.codingSession.create({
    data: {
      workspaceId: input.workspaceId,
      engine: input.engine,
      spaceId: input.spaceId,
      userId: input.userId,
      botId: input.botId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.title ? { title: input.title } : {}),
      status: "active",
    },
  });
  await tx.codingWorkspaceLease.updateMany({
    where: { workspaceId: input.workspaceId },
    data: { sessionId: session.id as string, updatedAt: now },
  });
  return session.id as string;
}

/**
 * Creates a session bound to (workspaceId, engine) and takes the exclusive
 * workspace lease inside one transaction. An unknown engine or a busy
 * workspace leaves no rows behind.
 */
export async function createCodingSession(
  deps: SessionServiceDeps,
  input: {
    workspaceId: string;
    engine: CodingSessionRef["engine"];
    spaceId: string;
    userId: string;
    botId: string;
    threadId?: string;
    title?: string;
    owner?: string;
  },
): Promise<CodingSessionRef> {
  if (!isCodingEngineId(input.engine)) {
    throw new Error(
      `Unknown coding engine ${JSON.stringify(input.engine)}. Supported: normal-pi, omp.`,
    );
  }
  if (deps.registry && !deps.registry.get(input.engine)) {
    throw new EngineUnavailableError(input.engine);
  }
  const sessionId = await deps.prisma.$transaction(async (tx) =>
    createCodingSessionInTx(tx, deps, input),
  );
  return createCodingSessionRef({
    id: sessionId,
    workspaceId: input.workspaceId,
    engine: input.engine,
  });
}

export class EngineUnavailableError extends Error {
  readonly engine: CodingSessionRef["engine"];

  constructor(engine: CodingSessionRef["engine"]) {
    super(
      `Coding engine "${engine}" has no registered adapter; refusing instead of switching engines.`,
    );
    this.name = "EngineUnavailableError";
    this.engine = engine;
  }
}

/**
 * Loads a session and reattaches to its workspace lease. Durable across
 * restarts: the (workspace, engine) binding comes from the stored row and can
 * never change on reattach — a requestedEngine that differs is a typed
 * EngineMismatchError (LOW-1). MED-3 (fix round): claiming an expired foreign
 * lease is a single conditional update (expiry + fence), so of two concurrent
 * attaches exactly one wins and the loser is refused explicitly. LOW-2: the
 * own-lease renewal is conditioned on the fence read moments earlier.
 */
export async function loadCodingSession(
  deps: SessionServiceDeps,
  input: { sessionId: string; requestedEngine?: CodingSessionRef["engine"]; owner?: string },
): Promise<CodingSessionRef> {
  return deps.prisma.$transaction(async (tx) => {
    const row = await tx.codingSession.findUnique({ where: { id: input.sessionId } });
    if (!row) throw new CodingSessionNotFoundError(input.sessionId);
    const view = sessionView(row as Record<string, unknown>);
    if (input.requestedEngine !== undefined && input.requestedEngine !== view.engine) {
      throw new EngineMismatchError(view.engine, input.requestedEngine);
    }
    const owner = input.owner ?? String(row.userId);
    const existing = await tx.codingWorkspaceLease.findUnique({
      where: { workspaceId: view.workspaceId },
    });
    if (!existing) {
      // No lease row: create one; on a create race, fall through to the
      // conditional takeover of whatever the winner wrote.
      try {
        await tx.codingWorkspaceLease.create({
          data: {
            workspaceId: view.workspaceId,
            sessionId: view.id,
            owner,
            fence: 1,
            expiresAt: leaseExpiry(deps, deps.now()),
            createdAt: deps.now(),
            updatedAt: deps.now(),
          },
        });
        return view;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    const now = deps.now();
    const expiresAt = leaseExpiry(deps, now);
    const current =
      existing ??
      (await tx.codingWorkspaceLease.findUnique({ where: { workspaceId: view.workspaceId } }));
    if (!current) {
      throw new WorkspaceBusyError(view.workspaceId, "lease row vanished during attach");
    }
    if (current.sessionId === view.id) {
      // Own lease (fresh or lapsed): renew and bump the fence, conditioned on
      // the fence just read — a concurrent claim would have moved it (LOW-2).
      const renewed = await tx.codingWorkspaceLease.updateMany({
        where: { workspaceId: view.workspaceId, sessionId: view.id, fence: current.fence },
        data: { owner, fence: { increment: 1 }, expiresAt, updatedAt: now },
      });
      if (renewed.count !== 1) {
        throw new WorkspaceBusyError(
          view.workspaceId,
          "the lease changed concurrently during reattach",
        );
      }
      return view;
    }
    // Foreign lease: only an EXPIRED one can be taken over, atomically.
    if (!leaseExpired(current, now)) {
      throw new WorkspaceBusyError(
        view.workspaceId,
        `lease is held by another session (${String(current.sessionId)})`,
      );
    }
    const taken = await tx.codingWorkspaceLease.updateMany({
      where: {
        workspaceId: view.workspaceId,
        sessionId: String(current.sessionId),
        fence: current.fence,
        expiresAt: { lte: now },
      },
      data: { sessionId: view.id, owner, fence: { increment: 1 }, expiresAt, updatedAt: now },
    });
    if (taken.count !== 1) {
      throw new WorkspaceBusyError(
        view.workspaceId,
        "another attach claimed the expired lease concurrently; never last-writer-wins",
      );
    }
    return view;
  });
}

/**
 * MED-2 (fix round): lease ownership revalidation + renewal for the session
 * activity touchpoints (prompt/steer/stop/resume). Slides the expiry forward
 * when — and only when — the session still holds a LIVE lease at the fence
 * read here. A lost or expired lease refuses with LeaseLostError; it is never
 * silently re-taken (that is an explicit loadCodingSession decision).
 */
export async function touchCodingSessionLease(
  deps: SessionServiceDeps,
  input: { sessionId: string },
): Promise<void> {
  await deps.prisma.$transaction(async (tx) => touchCodingSessionLeaseInTx(tx, deps, input));
}

/**
 * Transaction-client variant of touchCodingSessionLease for callers that are
 * already inside a transaction (the adapter's prompt path).
 */
export async function touchCodingSessionLeaseInTx(
  tx: SessionStoreTx,
  clock: SessionLeaseClock,
  input: { sessionId: string },
): Promise<void> {
  const now = clock.now();
  const row = await tx.codingSession.findUnique({ where: { id: input.sessionId } });
  if (!row) throw new CodingSessionNotFoundError(input.sessionId);
  const view = sessionView(row as Record<string, unknown>);
  const lease = await tx.codingWorkspaceLease.findUnique({
    where: { workspaceId: view.workspaceId },
  });
  if (!lease) {
    throw new LeaseLostError(view.id, "no lease row exists for the workspace");
  }
  if (lease.sessionId !== view.id) {
    throw new LeaseLostError(
      view.id,
      `the lease is held by another session (${String(lease.sessionId)})`,
    );
  }
  if (leaseExpired(lease, now)) {
    throw new LeaseLostError(view.id, "the lease expired and was not renewed in time");
  }
  const renewed = await tx.codingWorkspaceLease.updateMany({
    where: { workspaceId: view.workspaceId, sessionId: view.id, fence: lease.fence },
    data: { expiresAt: leaseExpiry(clock, now), updatedAt: now },
  });
  if (renewed.count !== 1) {
    throw new LeaseLostError(view.id, "the lease changed concurrently during renewal");
  }
}

/**
 * Stops a session and releases its workspace lease. LOW-2 (fix round): the
 * delete is conditioned on the fence read here — if a concurrent takeover
 * moved the fence between read and delete, the lease belongs to a new owner
 * and is left alone.
 */
export async function releaseCodingSession(
  deps: SessionServiceDeps,
  input: { sessionId: string },
): Promise<void> {
  const now = deps.now();
  await deps.prisma.$transaction(async (tx) => {
    const row = await tx.codingSession.findUnique({ where: { id: input.sessionId } });
    if (!row) throw new CodingSessionNotFoundError(input.sessionId);
    await tx.codingSession.update({
      where: { id: input.sessionId },
      data: { status: "stopped", updatedAt: now },
    });
    const lease = await tx.codingWorkspaceLease.findFirst({
      where: { sessionId: input.sessionId },
    });
    await tx.codingWorkspaceLease.deleteMany({
      where: { sessionId: input.sessionId, ...(lease ? { fence: lease.fence } : {}) },
    });
  });
}

/**
 * V15 service path: stop the original session, then create the labelled
 * continuation on the same workspace (engine change only when labelled with a
 * handoff summary — the rules live in planContinuation). The original row is
 * never mutated beyond status/handoff provenance; history is preserved.
 *
 * MED-4 (fix round): stop → lease release → continuation create → provenance
 * update all run inside ONE transaction — a mid-sequence throw leaves no
 * partial continuation. "The original run stopped" is derived from the row
 * inside the transaction (status === "stopped"), never from a caller-supplied
 * boolean.
 */
export async function continueCodingSession(
  deps: SessionServiceDeps,
  input: {
    originalSessionId: string;
    targetEngine: CodingSessionRef["engine"];
    label?: string;
    handoffSummary?: string;
    owner?: string;
  },
): Promise<CodingSessionRef> {
  const created = await deps.prisma.$transaction(
    async (
      tx,
    ): Promise<{ id: string; workspaceId: string; engine: CodingSessionRef["engine"] }> => {
      const originalRow = await tx.codingSession.findUnique({
        where: { id: input.originalSessionId },
      });
      if (!originalRow) throw new CodingSessionNotFoundError(input.originalSessionId);
      const original = sessionView(originalRow as Record<string, unknown>);
      const plan = planContinuation({
        originalSession: original,
        originalRunStopped: originalRow.status === "stopped",
        targetEngine: input.targetEngine,
        ...(deps.registry ? { registry: deps.registry } : {}),
        ...(input.handoffSummary !== undefined ? { handoffSummary: input.handoffSummary } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
      });
      await tx.codingSession.update({
        where: { id: original.id },
        data: {
          status: "stopped",
          ...(plan.label ? { engineChangeLabel: plan.label } : {}),
          ...(plan.handoffSummary ? { handoffSummary: plan.handoffSummary } : {}),
        },
      });
      // Release the original's lease, conditioned on the fence read here.
      const lease = await tx.codingWorkspaceLease.findFirst({
        where: { sessionId: original.id },
      });
      await tx.codingWorkspaceLease.deleteMany({
        where: { sessionId: original.id, ...(lease ? { fence: lease.fence } : {}) },
      });
      const continuationId = await createCodingSessionInTx(tx, deps, {
        workspaceId: original.workspaceId,
        engine: plan.nextSession.engine,
        spaceId: String(originalRow.spaceId),
        userId: String(originalRow.userId),
        botId: String(originalRow.botId),
        ...(originalRow.threadId ? { threadId: String(originalRow.threadId) } : {}),
        owner: input.owner,
      });
      await tx.codingSession.update({
        where: { id: continuationId },
        data: {
          continuationOf: original.id,
          ...(plan.label ? { engineChangeLabel: plan.label } : {}),
          ...(plan.handoffSummary ? { handoffSummary: plan.handoffSummary } : {}),
        },
      });
      return {
        id: continuationId,
        workspaceId: original.workspaceId,
        engine: plan.nextSession.engine,
      };
    },
  );
  return createCodingSessionRef(created);
}
/**
 * Crash reconciliation report (T23/V6).
 *
 * Produced after a session run terminates abnormally. The report carries:
 * - lastAction: what the last run was doing when the session ended
 * - dirtySet: workspace files that differ from the last checkpoint revision
 * - stoppedNeverSuccess: a crashed/stopped run is never reported as success
 *
 * This function is REPORT-ONLY: it returns the report for the caller to act on.
 * It never initiates a retry — that is the caller's decision.
 *
 * Architecture note: CodingSession records a latestRunId; the run row carries the
 * status (running/cancelled/completed). The homeRevision lives on the Computer
 * record, not the CodingSession — reconcileCrash accepts the botId so the caller
 * can look up the Computer.homeRevision and pass it as homeRevision.
 */
export type ReconcileCrashResult = {
  sessionId: string;
  lastAction: "crashed" | "cancelled" | "completed" | "none";
  /** True when lastAction is "crashed" — a stopped run is never success. */
  stoppedNeverSuccess: boolean;
  /** Dirty-set from the home store. Empty when homeStore is absent. */
  dirtySet: import("@rakazo/adapter-kit").WorkspaceDirtySet;
  latestRunId: string | null;
};

/**
 * Build a crash reconciliation report for the given session.
 *
 * @param deps - SessionServiceDeps (prisma + optional homeStore)
 * @param sessionId - the session to reconcile
 * @param homeRevision - the Computer.homeRevision at the time of the last checkpoint.
 *                       Required for dirty-set; omit for an offline/placeholder report.
 */
export async function reconcileCrash(
  deps: SessionServiceDeps,
  sessionId: string,
  homeRevision?: string,
): Promise<ReconcileCrashResult> {
  const sessionRow = await deps.prisma.codingSession.findUnique({
    where: { id: sessionId },
  });
  if (!sessionRow) {
    throw new Error(`Coding session "${sessionId}" not found`);
  }

  const latestRunId = (sessionRow.latestRunId as string | null) ?? null;

  // Derive lastAction from the run row status
  let lastAction: ReconcileCrashResult["lastAction"] = "none";
  if (latestRunId != null) {
    const runRow = await deps.prisma.run.findFirst({
      where: { id: latestRunId },
    });
    if (runRow) {
      if (runRow.status === "running") lastAction = "crashed";
      else if (runRow.status === "cancelled") lastAction = "cancelled";
      else if (runRow.status === "completed") lastAction = "completed";
    }
  }

  // stoppedNeverSuccess: a crashed (running when checked) or cancelled run is never success
  const stoppedNeverSuccess = lastAction === "crashed" || lastAction === "cancelled";

  // Dirty-set from the home store (optional — offline path gets empty set)
  let dirtySet: import("@rakazo/adapter-kit").WorkspaceDirtySet = {
    changed: [],
    added: [],
    removed: [],
  };
  if (deps.homeStore && homeRevision) {
    dirtySet = await deps.homeStore.changesSince(sessionRow.botId as string, homeRevision);
  }

  return {
    sessionId,
    lastAction,
    stoppedNeverSuccess,
    dirtySet,
    latestRunId,
  };
}
