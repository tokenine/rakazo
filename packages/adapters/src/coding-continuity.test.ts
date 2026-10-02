/**
 * 004-code-mode T22/T23 — V6 continuity + crash reconciliation.
 *
 * V6: Disconnect/reconnect + crash reconciliation.
 *
 * T22 — Disconnect/reconnect:
 * - Server-owned run continues within configured limits when client disconnects.
 * - Reconnect shows pending approvals.
 * - Reconnect attach is idempotent: no duplicate run.
 *
 * T23 — Crash reconciliation:
 * - After a crash, reconciliation reports workspace dirty-set (from home-revisions
 *   dirty-set query) + last recorded action BEFORE any retry.
 * - "Stopped never implies success."
 *
 * Tests exercise the session-service store seam with in-memory fakes,
 * following the offline-deterministic convention. Real binary verification (actual
 * OMP disconnect/reconnect) is a later QA lane.
 */

import { rm } from "node:fs/promises";
import type { PrismaClient } from "@rakazo/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCodingSession,
  createSessionServiceDeps,
  reconcileCrash,
  type SessionServiceStore,
} from "./coding-session-service.js";

// ---------------------------------------------------------------------------
// Module-level temp dir cleanup
// ---------------------------------------------------------------------------

const moduleTmpDirs: string[] = [];

afterEach(async () => {
  await Promise.allSettled(
    moduleTmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

function _registerTempDir(dir: string) {
  moduleTmpDirs.push(dir);
}

// ---------------------------------------------------------------------------
// In-memory SessionServiceStore + fake $transaction prisma
// ---------------------------------------------------------------------------

function makeFakePrismaWithTransaction(): {
  prisma: PrismaClient;
  store: SessionServiceStore;
  addRunToSession: (sessionId: string, status: string, completedAt?: Date | null) => string;
  addPendingEffect: (runId: string, id?: string) => void;
  getSession: (id: string) => Record<string, unknown> | undefined;
  getRuns: () => Array<{ id: string; status: string; completedAt: Date | null; sessionId: string }>;
} {
  const sessions: Array<Record<string, unknown>> = [];
  const leases: Array<Record<string, unknown>> = [];
  const store: SessionServiceStore = { sessions, leases };
  const runs: Array<{ id: string; status: string; completedAt: Date | null; sessionId: string }> =
    [];
  const pendingEffects: Array<{ id: string; runId: string; kind: string; status: string }> = [];
  let nextSessionId = 1;
  let nextRunId = 1;

  const fakeTxClient = {
    codingSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: Record<string, unknown> = { id: `session-${nextSessionId++}`, ...data };
        sessions.push(row);
        return row as never;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        (sessions.find((s) => s.id === where.id) ?? null) as never,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = sessions.findIndex((s) => s.id === where.id);
        if (idx < 0) throw new Error(`Session ${where.id} not found`);
        sessions[idx] = { ...sessions[idx], ...data };
        return sessions[idx] as never;
      },
      findMany: async () => sessions as never,
      findFirst: async () => sessions[0] as never,
    },
    codingWorkspaceLease: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: Record<string, unknown> = { ...data };
        leases.push(row);
        return row as never;
      },
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        (leases.find((l) => {
          if (where.workspaceId && l.workspaceId !== where.workspaceId) return false;
          return true;
        }) ?? null) as never,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        (leases.find((l) => {
          if (where.sessionId && l.sessionId !== where.sessionId) return false;
          return true;
        }) ?? null) as never,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        leases.forEach((l, _i) => {
          if (where.sessionId && l.sessionId !== where.sessionId) return;
          if (where.workspaceId && l.workspaceId !== where.workspaceId) return;
          Object.assign(l, data);
          count++;
        });
        return { count } as never;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = leases.length;
        leases.splice(
          0,
          leases.length,
          ...leases.filter((l) => {
            if (where.sessionId && l.sessionId === where.sessionId) return false;
            return true;
          }),
        );
        return { count: before - leases.length } as never;
      },
    },
    run: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `run-${nextRunId++}`, ...data } as {
          id: string;
          status: string;
          completedAt: Date | null;
          sessionId: string;
        };
        runs.push(row);
        return row as never;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        (runs.find((r) => r.id === where.id) ?? null) as never,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        (runs.find((r) => {
          if ("id" in where && r.id !== where.id) return false;
          if ("status" in where && "in" in (where.status as object)) {
            const statuses = (where.status as { in: string[] }).in;
            if (!statuses.includes(r.status)) return false;
          }
          return true;
        }) ?? null) as never,
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        let result = runs;
        if ("status" in where && "in" in (where.status as object)) {
          const statuses = (where.status as { in: string[] }).in;
          result = result.filter((r) => statuses.includes(r.status));
        }
        return result as never;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = runs.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error(`Run ${where.id} not found`);
        Object.assign(runs[idx]!, data);
        return runs[idx]! as never;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        runs.forEach((r, i) => {
          if ("id" in where && r.id !== where.id) return;
          Object.assign(runs[i]!, data);
          count++;
        });
        return { count } as never;
      },
    },
    task: {
      create: async ({ data }: { data: Record<string, unknown> }) => data as never,
    },
    steeringMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => data as never,
    },
    externalEffect: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.runId) {
          return pendingEffects.filter(
            (e) => e.runId === where.runId && e.status === "pending",
          ) as never;
        }
        return pendingEffects as never;
      },
    },
  };

  const fakeClient = {
    ...fakeTxClient,
    $transaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => {
      return fn(fakeTxClient);
    },
    $connect: async () => {},
    $disconnect: async () => {},
  } as unknown as PrismaClient;

  function addRunToSession(
    sessionId: string,
    status: string,
    completedAt: Date | null = null,
  ): string {
    const runId = `run-${nextRunId++}`;
    runs.push({ id: runId, status, completedAt, sessionId });
    // Also update the session's latestRunId
    const sessionIdx = sessions.findIndex((s) => s.id === sessionId);
    if (sessionIdx >= 0) {
      sessions[sessionIdx] = { ...sessions[sessionIdx], latestRunId: runId };
    }
    return runId;
  }

  function addPendingEffect(runId: string, id = "effect-1"): void {
    pendingEffects.push({ id, runId, kind: "shell", status: "pending" });
  }

  function getSession(id: string): Record<string, unknown> | undefined {
    return sessions.find((s) => s.id === id);
  }

  function getRuns() {
    return runs;
  }

  return {
    prisma: fakeClient,
    store,
    addRunToSession,
    addPendingEffect,
    getSession,
    getRuns,
  };
}

// ---------------------------------------------------------------------------
// T22: disconnect/reconnect — no duplicate run
// ---------------------------------------------------------------------------

describe("T22 — disconnect/reconnect: server-owned run continues, reconnect idempotent (V6)", () => {
  /**
   * Fake run machinery for the normal-pi adapter.
   */
  function makeFakeMachinery() {
    const continued: string[] = [];
    const aborted: string[] = [];
    const machinery = {
      continueRun: async (runId: string) => {
        continued.push(runId);
        return { continued: true };
      },
      abortRun: async (runId: string) => {
        aborted.push(runId);
        return { aborted: true };
      },
    };
    return { machinery, continued, aborted };
  }

  it("reconnect prompt returns same runId with steered:true — no second run created", async () => {
    const { store, prisma } = makeFakePrismaWithTransaction();
    const enqueued: string[] = [];
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });
    const session = await createCodingSession(deps, {
      workspaceId: "ws-reconnect",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    // LOW-4: threadId is required by the adapter; inject it like the real creation flow would
    const sessionRow = store.sessions.find((s) => s.id === session.id)! as Record<string, unknown>;
    sessionRow.threadId = "thread-1";

    const CodingPiAdapter = await import("./coding-pi-adapter.js");
    const adapter = CodingPiAdapter.createCodingPiAdapter({
      prisma: prisma as unknown as PrismaClient,
      jobs: {
        enqueue: async (job: unknown) => {
          // Capture the job — the only job the adapter enqueues on prompt is runContinueJob
          enqueued.push((job as { name?: string }).name ?? String(job));
        },
      },
      events: { append: async () => {} },
      machinery: {
        continueRun: async () => ({ continued: true }),
        abortRun: async () => ({ aborted: true }),
      },
      workerId: "worker-1",
      inspectChanges: async () => ({ messages: [], toolResults: [] }),
      now: () => new Date("2026-10-01T00:00:00Z"),
      leaseTtlMs: 600_000,
    });

    // First prompt — creates a new run
    const r1 = (await adapter.dispatch(session, "prompt", {
      text: "hello",
      messageId: "msg-1",
    })) as { runId: string; steered: boolean };

    // Second prompt on the same session — reconnects to the existing active run
    const r2 = (await adapter.dispatch(session, "prompt", {
      text: "hello again",
      messageId: "msg-2",
    })) as { runId: string; steered: boolean };

    // Same runId, and it was a steer not a new run
    expect(r2.runId).toBe(r1.runId);
    expect(r2.steered).toBe(true);

    // Only one job enqueue (the first prompt); the reconnect/steer did not enqueue
    expect(enqueued.length).toBe(1);
  });

  it("reconnect shows pending approvals — approvals queryable after reconnect", async () => {
    const { store, prisma } = makeFakePrismaWithTransaction();
    const { machinery } = makeFakeMachinery();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });
    const session = await createCodingSession(deps, {
      workspaceId: "ws-reconnect-approvals",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });
    const sessionRow2 = store.sessions.find((s) => s.id === session.id)! as Record<string, unknown>;
    sessionRow2.threadId = "thread-2";

    const CodingPiAdapter = await import("./coding-pi-adapter.js");
    const adapter = CodingPiAdapter.createCodingPiAdapter({
      prisma: prisma as unknown as PrismaClient,
      jobs: { enqueue: async () => {} },
      events: { append: async () => {} },
      machinery,
      workerId: "worker-1",
      inspectChanges: async () => ({ messages: [], toolResults: [] }),
      now: () => new Date("2026-10-01T00:00:00Z"),
      leaseTtlMs: 600_000,
    });

    // First prompt creates the run
    await adapter.dispatch(session, "prompt", { text: "hello", messageId: "msg-1" });

    // Approvals op succeeds (even if empty)
    const approvals = (await adapter.dispatch(session, "approvals", {})) as { pending: unknown[] };
    expect(Array.isArray(approvals.pending)).toBe(true);
  });

  it("stop releases the run, reconnect cannot re-attach to a stopped run", async () => {
    const { store, prisma } = makeFakePrismaWithTransaction();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });
    const session = await createCodingSession(deps, {
      workspaceId: "ws-stopped",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });
    const sessionRow3 = store.sessions.find((s) => s.id === session.id)! as Record<string, unknown>;
    sessionRow3.threadId = "thread-3";

    const CodingPiAdapter = await import("./coding-pi-adapter.js");
    const adapter = CodingPiAdapter.createCodingPiAdapter({
      prisma: prisma as unknown as PrismaClient,
      jobs: { enqueue: async () => {} },
      events: { append: async () => {} },
      machinery: {
        continueRun: async () => ({ continued: true }),
        abortRun: async () => ({ aborted: true }),
      },
      workerId: "worker-1",
      inspectChanges: async () => ({ messages: [], toolResults: [] }),
      now: () => new Date("2026-10-01T00:00:00Z"),
      leaseTtlMs: 600_000,
    });

    // Create the run
    const r1 = (await adapter.dispatch(session, "prompt", {
      text: "hello",
      messageId: "msg-1",
    })) as { runId: string; steered: boolean };

    // Stop the session
    const stopped = (await adapter.dispatch(session, "stop", {})) as { stopped: boolean };
    expect(stopped.stopped).toBe(true);

    // Session is now stopped — reconnect prompt creates a new run
    const r2 = (await adapter.dispatch(session, "prompt", {
      text: "hello after stop",
      messageId: "msg-2",
    })) as { runId: string; steered: boolean };

    expect(r2.steered).toBe(false);
    expect(r2.runId).not.toBe(r1.runId);
  });
});

// ---------------------------------------------------------------------------
// T23: crash reconciliation — dirty-set + last action, stopped ≠ success
// ---------------------------------------------------------------------------

/**
 * Crash reconciliation contract:
 * 1. reconcileCrash(sessionId) → { dirtySet, lastAction, stoppedNeverSuccess }
 * 2. lastAction is derived from the session's latestRunId row (status + completedAt)
 * 3. dirtySet comes from the versioned store (home-revisions changesSince)
 * 4. No automatic retry — caller must act on the report
 * 5. "Stopped never implies success" — stopped/cancelled != completed
 *
 * These tests verify the data shape and contract at the session+store seam.
 * Real crash-injection against the live executor is a later QA lane.
 */

describe("T23 — crash reconciliation: dirty-set + last action before retry (V6)", () => {
  /**
   * Fake home store for testing dirty-set computation.
   */
  function makeFakeHomeStore(changes?: {
    changed?: string[];
    added?: string[];
    removed?: string[];
  }) {
    return {
      changesSince: async (_botId: string, _revision: string) => ({
        changed: changes?.changed ?? [],
        added: changes?.added ?? [],
        removed: changes?.removed ?? [],
      }),
    } as unknown as import("@rakazo/adapter-kit").AgentHomeStore;
  }

  it("derives lastAction=crashed when latestRunId row has status=running", async () => {
    const { prisma, addRunToSession } = makeFakePrismaWithTransaction();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-crash",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    // Simulate a running run that crashed
    const runId = addRunToSession(session.id, "running");

    const result = await reconcileCrash(deps, session.id);
    expect(result.lastAction).toBe("crashed");
    expect(result.stoppedNeverSuccess).toBe(true);
    expect(result.latestRunId).toBe(runId);
    expect(result.sessionId).toBe(session.id);
  });

  it("derives lastAction=completed when latestRunId row has status=completed", async () => {
    const { prisma, addRunToSession } = makeFakePrismaWithTransaction();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-ok",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    const runId = addRunToSession(session.id, "completed", new Date("2026-10-01T12:00:00Z"));

    const result = await reconcileCrash(deps, session.id);
    expect(result.lastAction).toBe("completed");
    expect(result.stoppedNeverSuccess).toBe(false);
    expect(result.latestRunId).toBe(runId);
  });

  it("derives lastAction=cancelled when latestRunId row has status=cancelled", async () => {
    const { prisma, addRunToSession } = makeFakePrismaWithTransaction();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-stopped",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    const runId = addRunToSession(session.id, "cancelled", new Date("2026-10-01T12:00:00Z"));

    const result = await reconcileCrash(deps, session.id);
    expect(result.lastAction).toBe("cancelled");
    expect(result.stoppedNeverSuccess).toBe(true);
    expect(result.latestRunId).toBe(runId);
  });

  it("derives lastAction=cancelled when latestRunId row has status=cancelled", async () => {
    const { prisma, addRunToSession } = makeFakePrismaWithTransaction();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-stopped",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    const runId = addRunToSession(session.id, "cancelled", new Date("2026-10-01T12:00:00Z"));

    const result = await reconcileCrash(deps, session.id);
    expect(result.lastAction).toBe("cancelled");
    expect(result.stoppedNeverSuccess).toBe(true);
    expect(result.latestRunId).toBe(runId);
  });

  it("derives lastAction=none when latestRunId is null", async () => {
    const { prisma } = makeFakePrismaWithTransaction();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-fresh",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    const result = await reconcileCrash(deps, session.id);
    expect(result.lastAction).toBe("none");
    expect(result.stoppedNeverSuccess).toBe(false);
    expect(result.latestRunId).toBeNull();
  });

  it("throws for an unknown session", async () => {
    const { prisma } = makeFakePrismaWithTransaction();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });

    await expect(reconcileCrash(deps, "unknown-session")).rejects.toThrow(
      'Coding session "unknown-session" not found',
    );
  });

  it("queries homeStore.changesSince with botId and homeRevision", async () => {
    const { prisma, addRunToSession } = makeFakePrismaWithTransaction();
    const fakeHome = makeFakeHomeStore({ changed: ["src/index.ts"], added: [], removed: [] });
    const deps = createSessionServiceDeps({
      prisma: prisma as unknown as PrismaClient,
      homeStore: fakeHome,
    });
    const session = await createCodingSession(deps, {
      workspaceId: "ws-home-check",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-home",
    });
    addRunToSession(session.id, "running");
    const result = await reconcileCrash(deps, session.id, "rev-checkpoint-001");
    expect(result.dirtySet).toEqual({ changed: ["src/index.ts"], added: [], removed: [] });
    expect(result.lastAction).toBe("crashed");
  });

  it("returns empty dirtySet when homeStore is absent", async () => {
    const { prisma, addRunToSession } = makeFakePrismaWithTransaction();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-no-home",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-no-home",
    });

    addRunToSession(session.id, "running");

    const result = await reconcileCrash(deps, session.id, "rev-ignored");
    expect(result.dirtySet).toEqual({ changed: [], added: [], removed: [] });
  });

  it("report is available before any retry — no side effects", async () => {
    const { store, prisma, addRunToSession } = makeFakePrismaWithTransaction();
    const deps = createSessionServiceDeps({ prisma: prisma as unknown as PrismaClient });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-no-auto-retry",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    addRunToSession(session.id, "running");

    // Reconciliation is a read-only report — no side effects in the store
    const result = await reconcileCrash(deps, session.id);
    expect(result.lastAction).toBe("crashed");
    expect(result.stoppedNeverSuccess).toBe(true);

    // Session is still active (no auto-stop on reconciliation)
    const sessionRow = store.sessions.find((s) => s.id === session.id)!;
    expect((sessionRow as Record<string, unknown>).status).toBe("active");
  });
});
