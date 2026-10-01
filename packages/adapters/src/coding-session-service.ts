/**
 * 004-code-mode T1 — coding session service (Q3).
 *
 * A durable session bound to (workspaceId, engine) at creation. The
 * per-workspace lease table makes a workspace single-owner: a second run
 * cannot attach while the lease is held (never last-writer-wins). Expired
 * leases are taken over with a bumped fence, mirroring the existing
 * run/computer lease pattern. Rows live in Postgres, so the binding survives
 * restarts; reattach never changes the engine.
 */

import type { PrismaClient } from "@rakazo/db";
import {
  type CodingSessionRef,
  createCodingSessionRef,
  type EngineRegistry,
  isCodingEngineId,
  planContinuation,
} from "./coding-engine.js";

// continueCodingSession surfaces these rules; re-exported for consumers.
export { ContinuationRefusedError } from "./coding-engine.js";

const DEFAULT_LEASE_TTL_MS = 10 * 60_000;

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

/** The prisma surface this service uses (also the fake-double contract). */
export interface SessionServiceStore {
  sessions: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
}

export interface SessionServiceDeps {
  prisma: PrismaClient;
  /** When present, continuation engine changes also require a registered adapter. */
  registry?: EngineRegistry;
  now: () => Date;
  leaseTtlMs: number;
}

export function createSessionServiceDeps(input: {
  prisma: PrismaClient;
  registry?: EngineRegistry;
  now?: () => Date;
  leaseTtlMs?: number;
}): SessionServiceDeps {
  return {
    prisma: input.prisma,
    ...(input.registry ? { registry: input.registry } : {}),
    now: input.now ?? (() => new Date()),
    leaseTtlMs: input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    Boolean(error) && typeof error === "object" && (error as { code?: string }).code === "P2002"
  );
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
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + deps.leaseTtlMs);
  const owner = input.owner ?? input.userId;
  const sessionId = await deps.prisma.$transaction(async (tx) => {
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
      // Lease row exists: take it over only when expired; refuse when busy.
      const taken = await tx.codingWorkspaceLease.updateMany({
        where: { workspaceId: input.workspaceId, expiresAt: { lte: now } },
        data: { owner, fence: { increment: 1 }, expiresAt, updatedAt: now },
      });
      if (taken.count !== 1) {
        throw new WorkspaceBusyError(
          input.workspaceId,
          "another coding session holds the lease; never last-writer-wins on an active workspace",
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
  });
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
 * never change on reattach. A foreign active holder refuses; an expired lease
 * is taken over with a bumped fence.
 */
export async function loadCodingSession(
  deps: SessionServiceDeps,
  input: { sessionId: string; requestedEngine?: CodingSessionRef["engine"]; owner?: string },
): Promise<CodingSessionRef> {
  const now = deps.now();
  return deps.prisma.$transaction(async (tx) => {
    const row = await tx.codingSession.findUnique({ where: { id: input.sessionId } });
    if (!row) throw new CodingSessionNotFoundError(input.sessionId);
    const view = sessionView(row as Record<string, unknown>);
    const lease = await tx.codingWorkspaceLease.findUnique({
      where: { workspaceId: view.workspaceId },
    });
    if (lease && lease.sessionId !== view.id) {
      const expired = (lease.expiresAt as Date).getTime() <= now.getTime();
      if (!expired) {
        throw new WorkspaceBusyError(
          view.workspaceId,
          `lease is held by another session (${String(lease.sessionId)})`,
        );
      }
    }
    // (Re)claim the lease for this session, bumping the fence on every take.
    await tx.codingWorkspaceLease.upsert({
      where: { workspaceId: view.workspaceId },
      create: {
        workspaceId: view.workspaceId,
        sessionId: view.id,
        owner: input.owner ?? String(row.userId),
        fence: 1,
        expiresAt: new Date(now.getTime() + deps.leaseTtlMs),
        createdAt: now,
        updatedAt: now,
      },
      update: {
        sessionId: view.id,
        owner: input.owner ?? String(row.userId),
        fence: { increment: 1 },
        expiresAt: new Date(now.getTime() + deps.leaseTtlMs),
        updatedAt: now,
      },
    });
    return view;
  });
}

/** Stops a session and releases its workspace lease. */
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
    await tx.codingWorkspaceLease.deleteMany({ where: { sessionId: input.sessionId } });
  });
}

/**
 * V15 service path: stop the original session, then create the labelled
 * continuation on the same workspace (engine change only when labelled with a
 * handoff summary — the rules live in planContinuation). The original row is
 * never mutated beyond status/handoff provenance; history is preserved.
 */
export async function continueCodingSession(
  deps: SessionServiceDeps,
  input: {
    originalSessionId: string;
    originalRunStopped: boolean;
    targetEngine: CodingSessionRef["engine"];
    label?: string;
    handoffSummary?: string;
    owner?: string;
  },
): Promise<CodingSessionRef> {
  const originalRow = await deps.prisma.codingSession.findUnique({
    where: { id: input.originalSessionId },
  });
  if (!originalRow) throw new CodingSessionNotFoundError(input.originalSessionId);
  const original = sessionView(originalRow as Record<string, unknown>);
  const plan = planContinuation({
    originalSession: original,
    originalRunStopped: input.originalRunStopped,
    targetEngine: input.targetEngine,
    ...(deps.registry ? { registry: deps.registry } : {}),
    ...(input.handoffSummary !== undefined ? { handoffSummary: input.handoffSummary } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
  });
  await deps.prisma.codingSession.update({
    where: { id: original.id },
    data: {
      status: "stopped",
      ...(plan.label ? { engineChangeLabel: plan.label } : {}),
      ...(plan.handoffSummary ? { handoffSummary: plan.handoffSummary } : {}),
    },
  });
  await deps.prisma.codingWorkspaceLease.deleteMany({ where: { sessionId: original.id } });
  const continuation = await createCodingSession(deps, {
    workspaceId: original.workspaceId,
    engine: plan.nextSession.engine,
    spaceId: String(originalRow.spaceId),
    userId: String(originalRow.userId),
    botId: String(originalRow.botId),
    ...(originalRow.threadId ? { threadId: String(originalRow.threadId) } : {}),
    owner: input.owner,
  });
  await deps.prisma.codingSession.update({
    where: { id: continuation.id },
    data: {
      continuationOf: original.id,
      ...(plan.label ? { engineChangeLabel: plan.label } : {}),
      ...(plan.handoffSummary ? { handoffSummary: plan.handoffSummary } : {}),
    },
  });
  return continuation;
}
