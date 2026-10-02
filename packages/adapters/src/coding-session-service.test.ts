import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { EngineMismatchError } from "./coding-engine.js";
import {
  ContinuationRefusedError,
  continueCodingSession,
  createCodingSession,
  createSessionServiceDeps,
  LeaseLostError,
  loadCodingSession,
  releaseCodingSession,
  type SessionServiceStore,
  touchCodingSessionLease,
  WorkspaceBusyError,
} from "./coding-session-service.js";

/**
 * Minimal in-memory prisma double for the two coding tables. Emulates the
 * unique-constraint behavior the real DB enforces for the workspace lease.
 * Fix round: updateMany/deleteMany honor the full conditional where-sets the
 * service now uses (sessionId, fence, expiresAt), and $transaction is
 * faithful — sequential execution with rollback-on-throw (MED-4). Hooks model
 * concurrent interleavings: onLeaseRead fires when the service reads a lease;
 * beforeLeaseUpdate lets a "racer" sneak a fence bump in between read and
 * write; failSessionUpdateWhen injects a mid-transaction crash.
 */
function fakePrisma(
  hooks: {
    onLeaseRead?: (lease: Record<string, unknown>) => void;
    beforeLeaseUpdate?: (lease: Record<string, unknown>) => void;
    failSessionUpdateWhen?: (data: Record<string, unknown>) => boolean;
  } = {},
) {
  const store: SessionServiceStore = { sessions: [], leases: [] };
  const uniqueViolation = () => {
    const error = new Error("Unique constraint failed") as Error & { code: string };
    error.code = "P2002";
    return error;
  };
  const applyLeaseData = (lease: Record<string, unknown>, data: Record<string, unknown>) => {
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (value !== null && typeof value === "object" && "increment" in (value as object)) {
        lease[key] = ((lease[key] as number) ?? 0) + (value as { increment: number }).increment;
      } else {
        lease[key] = value;
      }
    }
  };
  const findSession = (id: string) => store.sessions.find((row) => row.id === id);
  const prisma = {
    codingSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          acceptance: null,
          refusals: 0,
          latestRunId: null,
          status: "active",
          ...data,
          // Real prisma mints a cuid when no id is provided.
          id: (data.id as string | undefined) ?? `session-${store.sessions.length + 1}`,
        };
        store.sessions.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => findSession(where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        store.sessions.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (hooks.failSessionUpdateWhen?.(data)) {
          throw new Error("injected mid-transaction crash");
        }
        const row = findSession(where.id);
        if (!row) throw new Error("session not found");
        Object.assign(row, data);
        return row;
      },
    },
    codingWorkspaceLease: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (store.leases.some((lease) => lease.workspaceId === data.workspaceId)) {
          throw uniqueViolation();
        }
        const row = { ...data };
        store.leases.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { workspaceId: string } }) => {
        const lease = store.leases.find((entry) => entry.workspaceId === where.workspaceId) ?? null;
        if (lease) hooks.onLeaseRead?.(lease);
        return lease;
      },
      findFirst: async ({ where }: { where: { sessionId: string } }) => {
        const lease = store.leases.find((entry) => entry.sessionId === where.sessionId) ?? null;
        if (lease) hooks.onLeaseRead?.(lease);
        return lease;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          workspaceId: string;
          sessionId?: string;
          fence?: number;
          expiresAt?: { lte: Date };
        };
        data: Record<string, unknown>;
      }) => {
        const lease = store.leases.find((entry) => entry.workspaceId === where.workspaceId);
        if (!lease) return { count: 0 };
        hooks.beforeLeaseUpdate?.(lease);
        if (where.sessionId !== undefined && lease.sessionId !== where.sessionId) {
          return { count: 0 };
        }
        if (where.fence !== undefined && lease.fence !== where.fence) {
          return { count: 0 };
        }
        if (
          where.expiresAt?.lte &&
          (lease.expiresAt as Date).getTime() > where.expiresAt.lte.getTime()
        ) {
          return { count: 0 };
        }
        applyLeaseData(lease, data);
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: { sessionId: string; fence?: number } }) => {
        let removed = 0;
        for (let index = store.leases.length - 1; index >= 0; index -= 1) {
          const lease = store.leases[index]!;
          const fenceMatches = where.fence === undefined || lease.fence === where.fence;
          if (lease.sessionId === where.sessionId && fenceMatches) {
            store.leases.splice(index, 1);
            removed += 1;
          }
        }
        return { count: removed };
      },
    },
    $transaction: async (work: (client: unknown) => Promise<unknown>) => {
      // Faithful interactive transaction: sequential execution, and rollback
      // undoes ONLY this transaction's own writes — a concurrent transaction's
      // committed changes stay, mirroring row-level DB rollback (MED-4) and
      // keeping interleaved-race tests honest (MED-3).
      const undo: Array<() => void> = [];
      const added: Array<{ array: Array<Record<string, unknown>>; row: Record<string, unknown> }> =
        [];
      const snapMutation = (row: Record<string, unknown>) => {
        const copy = { ...row };
        undo.push(() => {
          // Restore field values AND drop keys the transaction added.
          for (const key of Object.keys(row)) {
            if (!(key in copy)) delete row[key];
          }
          for (const key of Object.keys(copy)) row[key] = copy[key];
        });
      };
      const impl = prisma as unknown as {
        codingSession: {
          create: (args: unknown) => Promise<Record<string, unknown>>;
          update: (args: unknown) => Promise<unknown>;
        };
        codingWorkspaceLease: {
          create: (args: unknown) => Promise<Record<string, unknown>>;
          updateMany: (args: unknown) => Promise<unknown>;
          deleteMany: (args: unknown) => Promise<unknown>;
        };
      };
      const txClient = {
        codingSession: {
          ...prisma.codingSession,
          create: async (args: unknown) => {
            const row = await impl.codingSession.create(args);
            added.push({ array: store.sessions, row });
            return row;
          },
          update: async (args: { where: { id: string } }) => {
            const row = store.sessions.find((entry) => entry.id === args.where.id);
            if (row) snapMutation(row);
            return impl.codingSession.update(args);
          },
        },
        codingWorkspaceLease: {
          ...prisma.codingWorkspaceLease,
          create: async (args: unknown) => {
            const row = await impl.codingWorkspaceLease.create(args);
            added.push({ array: store.leases, row });
            return row;
          },
          updateMany: async (args: { where: { workspaceId: string } }) => {
            const lease = store.leases.find(
              (entry) => entry.workspaceId === args.where.workspaceId,
            );
            if (lease) snapMutation(lease);
            return impl.codingWorkspaceLease.updateMany(args);
          },
          deleteMany: async (args: { where: { sessionId: string; fence?: number } }) => {
            const victims = store.leases.filter(
              (lease) =>
                lease.sessionId === args.where.sessionId &&
                (args.where.fence === undefined || lease.fence === args.where.fence),
            );
            if (victims.length > 0) {
              undo.push(() => {
                for (const victim of victims) store.leases.push(victim);
              });
            }
            return impl.codingWorkspaceLease.deleteMany(args);
          },
        },
      };
      try {
        return await work(txClient);
      } catch (error) {
        for (const reverse of undo.reverse()) reverse();
        for (const entry of added) {
          const index = entry.array.indexOf(entry.row);
          if (index >= 0) entry.array.splice(index, 1);
        }
        throw error;
      }
    },
  };
  return { prisma: prisma as unknown as PrismaClient, store };
}

const baseInput = {
  workspaceId: "ws-1",
  engine: "normal-pi" as const,
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
};

const T0 = new Date("2026-10-01T05:00:00Z");

describe("coding session creation binds (workspace, engine) (V13, T1)", () => {
  it("creates a session bound to the requested workspace and engine", async () => {
    const { prisma, store } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const session = await createCodingSession(deps, baseInput);
    expect(session.workspaceId).toBe("ws-1");
    expect(session.engine).toBe("normal-pi");
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]).toMatchObject({ workspaceId: "ws-1", engine: "normal-pi" });
    expect(store.leases).toHaveLength(1);
    expect(store.leases[0]).toMatchObject({ workspaceId: "ws-1", sessionId: session.id });
  });

  it("refuses a second session on a busy workspace — the lease is exclusive", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    await createCodingSession(deps, baseInput);
    await expect(
      createCodingSession(deps, { ...baseInput, engine: "omp" as const }),
    ).rejects.toBeInstanceOf(WorkspaceBusyError);
  });

  it("refuses an unknown engine at creation", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    await expect(
      createCodingSession(deps, { ...baseInput, engine: "zcode" as never }),
    ).rejects.toThrow(/unknown coding engine/i);
    // The refused creation must not burn the workspace lease.
    const retry = await createCodingSession(deps, baseInput);
    expect(retry.workspaceId).toBe("ws-1");
  });

  it("creation takes over an expired foreign lease via one conditional update (MED-3/LOW-2)", async () => {
    const { prisma, store } = fakePrisma();
    // A foreign session's lease expired at 05:10; the new session starts 06:00.
    store.leases.push({
      workspaceId: "ws-1",
      sessionId: "session-old",
      owner: "someone-else",
      fence: 3,
      expiresAt: new Date("2026-10-01T05:10:00Z"),
      createdAt: T0,
      updatedAt: T0,
    });
    const deps = createSessionServiceDeps({ prisma, now: () => new Date("2026-10-01T06:00:00Z") });
    const created = await createCodingSession(deps, baseInput);
    expect(store.leases).toHaveLength(1);
    expect(store.leases[0]).toMatchObject({ sessionId: created.id, fence: 4 });
  });

  it("creation refuses (and leaves no rows) when a racer moved the fence mid-takeover (LOW-2)", async () => {
    const { prisma, store } = fakePrisma({
      beforeLeaseUpdate: (lease) => {
        // A concurrent claimer bumps the fence after the service read it.
        lease.fence = ((lease.fence as number) ?? 0) + 1;
      },
    });
    store.leases.push({
      workspaceId: "ws-1",
      sessionId: "session-old",
      owner: "someone-else",
      fence: 3,
      expiresAt: new Date("2026-10-01T05:10:00Z"),
      createdAt: T0,
      updatedAt: T0,
    });
    const deps = createSessionServiceDeps({ prisma, now: () => new Date("2026-10-01T06:00:00Z") });
    await expect(createCodingSession(deps, baseInput)).rejects.toBeInstanceOf(WorkspaceBusyError);
    // Rollback: no session row, no partial lease mutation beyond the racer's.
    expect(store.sessions).toHaveLength(0);
    expect(store.leases[0]).toMatchObject({ sessionId: "session-old" });
  });
});

describe("workspace lease exclusivity and takeover (V13)", () => {
  it("refuses attach while a different session holds the lease", async () => {
    const { prisma, store } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const session = await createCodingSession(deps, baseInput);
    // Point the lease at a foreign holder to emulate a conflicting attach.
    const lease = store.leases.find((entry) => entry.workspaceId === "ws-1")!;
    lease.sessionId = "session-foreign";
    await expect(loadCodingSession(deps, { sessionId: session.id })).rejects.toBeInstanceOf(
      WorkspaceBusyError,
    );
  });

  it("reattaches the same session to the same (workspace, engine) — durable across restarts", async () => {
    const { prisma } = fakePrisma();
    const creation = createSessionServiceDeps({ prisma });
    const created = await createCodingSession(creation, baseInput);
    // Simulate a process restart: a brand-new service instance over the same rows.
    const restarted = createSessionServiceDeps({ prisma });
    const reattached = await loadCodingSession(restarted, { sessionId: created.id });
    expect(reattached.id).toBe(created.id);
    expect(reattached.workspaceId).toBe("ws-1");
    expect(reattached.engine).toBe("normal-pi");
  });

  it("a mismatched requestedEngine is a typed refusal (LOW-1) that never wedges the session", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const created = await createCodingSession(deps, baseInput);
    await expect(
      loadCodingSession(deps, { sessionId: created.id, requestedEngine: "omp" as never }),
    ).rejects.toBeInstanceOf(EngineMismatchError);
    // The same attach with the MATCHING engine still succeeds.
    const reattached = await loadCodingSession(deps, {
      sessionId: created.id,
      requestedEngine: "normal-pi",
    });
    expect(reattached.engine).toBe("normal-pi");
  });

  it("an expired lease does not wedge the workspace: takeover bumps the fence", async () => {
    const { prisma, store } = fakePrisma();
    const stale = createSessionServiceDeps({ prisma, now: () => T0 });
    const original = await createCodingSession(stale, baseInput);
    const fenceBefore = store.leases[0]!.fence as number;
    // Time passes; the lease expires; a later attach reclaims it.
    const later = createSessionServiceDeps({
      prisma,
      now: () => new Date("2026-10-01T06:00:00Z"),
    });
    const reattached = await loadCodingSession(later, { sessionId: original.id });
    expect(reattached.workspaceId).toBe("ws-1");
    expect(store.leases[0]!.fence).toBeGreaterThan(fenceBefore);
  });

  it("exactly one of two concurrent takeovers of an expired lease wins (MED-3)", async () => {
    const { prisma, store } = fakePrisma();
    // Session A holds the lease and dies; its lease expires at 05:10.
    const stale = createSessionServiceDeps({ prisma, now: () => T0 });
    await createCodingSession(stale, baseInput);
    const fenceBefore = store.leases[0]!.fence as number;
    // Two more sessions on the same workspace, created directly (their
    // creation raced while A still held the lease).
    for (const id of ["session-b", "session-c"]) {
      await prisma.codingSession.create({
        data: {
          id,
          workspaceId: "ws-1",
          engine: "normal-pi",
          spaceId: "space-1",
          userId: "user-1",
          botId: "bot-1",
          status: "active",
        },
      });
    }
    const later = new Date("2026-10-01T06:00:00Z");
    const depsB = createSessionServiceDeps({ prisma, now: () => later });
    const depsC = createSessionServiceDeps({ prisma, now: () => later });
    const results = await Promise.allSettled([
      loadCodingSession(depsB, { sessionId: "session-b" }),
      loadCodingSession(depsC, { sessionId: "session-c" }),
    ]);
    const fulfilled = results.filter((entry) => entry.status === "fulfilled");
    const rejected = results.filter((entry) => entry.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const loser = (rejected[0] as PromiseRejectedResult).reason;
    expect(loser).toBeInstanceOf(WorkspaceBusyError);
    // The loser is refused explicitly — either the winner's renewal beat it to
    // the expiry check ("held by another session") or the conditional update
    // flipped the row first ("claimed concurrently"). Never both winning.
    expect((loser as WorkspaceBusyError).message).toMatch(/held by another session|concurrently/);
    // The winner owns the lease and the fence moved exactly once. The loser's
    // rollback undoes only its own writes, so the winner's committed state stays.
    const winnerId =
      fulfilled[0] !== undefined
        ? (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value.id
        : undefined;
    expect(winnerId).toBe("session-b");
    expect(store.leases[0]).toMatchObject({ sessionId: winnerId, fence: fenceBefore + 1 });
  });

  it("a takeover whose expected fence moved after the read refuses instead of stomping (LOW-2)", async () => {
    const { prisma, store } = fakePrisma({
      beforeLeaseUpdate: (lease) => {
        lease.fence = ((lease.fence as number) ?? 0) + 1;
      },
    });
    const stale = createSessionServiceDeps({ prisma, now: () => T0 });
    const original = await createCodingSession(stale, baseInput);
    const fenceBefore = store.leases[0]!.fence as number;
    // Point the lease at a foreign (expired) holder so load takes the takeover path.
    store.leases[0]!.sessionId = "session-foreign";
    const later = createSessionServiceDeps({
      prisma,
      now: () => new Date("2026-10-01T06:00:00Z"),
    });
    await expect(loadCodingSession(later, { sessionId: original.id })).rejects.toBeInstanceOf(
      WorkspaceBusyError,
    );
    // The lease was NOT stomped: after the refused transaction rolls back, the
    // foreign holder's lease row is exactly as the racer left it.
    expect(store.leases[0]).toMatchObject({ sessionId: "session-foreign", fence: fenceBefore });
  });

  it("releasing a session frees the workspace for the next session", async () => {
    const { prisma, store } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const first = await createCodingSession(deps, baseInput);
    await releaseCodingSession(deps, { sessionId: first.id });
    expect(store.leases).toHaveLength(0);
    const second = await createCodingSession(deps, { ...baseInput, engine: "omp" as const });
    expect(second.engine).toBe("omp");
  });
});

describe("lease revalidation + renewal on session activity (MED-2)", () => {
  it("touching a held lease slides its expiry forward (renewal)", async () => {
    const { prisma, store } = fakePrisma();
    const created = await createCodingSession(createSessionServiceDeps({ prisma, now: () => T0 }), {
      ...baseInput,
    });
    const expiryBefore = store.leases[0]!.expiresAt as Date;
    const later = createSessionServiceDeps({
      prisma,
      now: () => new Date("2026-10-01T05:05:00Z"),
    });
    await touchCodingSessionLease(later, { sessionId: created.id });
    const expiryAfter = store.leases[0]!.expiresAt as Date;
    expect(expiryAfter.getTime()).toBe(new Date("2026-10-01T05:15:00Z").getTime());
    expect(expiryAfter.getTime()).toBeGreaterThan(expiryBefore.getTime());
  });

  it("touch refuses once the lease is held by another session (lease lost)", async () => {
    const { prisma, store } = fakePrisma();
    const created = await createCodingSession(createSessionServiceDeps({ prisma }), baseInput);
    store.leases[0]!.sessionId = "session-foreign";
    await expect(
      touchCodingSessionLease(createSessionServiceDeps({ prisma }), {
        sessionId: created.id,
      }),
    ).rejects.toBeInstanceOf(LeaseLostError);
  });

  it("touch refuses an expired lease instead of silently re-taking it", async () => {
    const { prisma } = fakePrisma();
    const created = await createCodingSession(createSessionServiceDeps({ prisma, now: () => T0 }), {
      ...baseInput,
    });
    const muchLater = createSessionServiceDeps({
      prisma,
      now: () => new Date("2026-10-01T07:00:00Z"),
    });
    await expect(
      touchCodingSessionLease(muchLater, { sessionId: created.id }),
    ).rejects.toBeInstanceOf(LeaseLostError);
  });

  it("touch refuses when there is no lease row at all (released session)", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const created = await createCodingSession(deps, baseInput);
    await releaseCodingSession(deps, { sessionId: created.id });
    await expect(touchCodingSessionLease(deps, { sessionId: created.id })).rejects.toBeInstanceOf(
      LeaseLostError,
    );
  });
});

describe("labelled continuation moves the workspace to the new session (V15 service path)", () => {
  it("stops the original session, transfers the lease, keeps history and engine binding", async () => {
    const { prisma, store } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const original = await createCodingSession(deps, baseInput);
    // MED-4: the original run must be stopped first — the ROW says so.
    await releaseCodingSession(deps, { sessionId: original.id });

    const continuation = await continueCodingSession(deps, {
      originalSessionId: original.id,
      targetEngine: "omp",
      label: "engine-change",
      handoffSummary: "auth refactor state",
    });
    expect(continuation.engine).toBe("omp");
    expect(continuation.workspaceId).toBe("ws-1");
    expect(store.leases).toHaveLength(1);
    expect(store.leases[0]!.sessionId).toBe(continuation.id);

    const originalRow = store.sessions.find((row) => row.id === original.id)!;
    expect(originalRow.status).toBe("stopped");
    expect(originalRow.engine).toBe("normal-pi");
    expect(originalRow.handoffSummary).toBe("auth refactor state");
    expect(originalRow.continuationOf).toBeUndefined();
    expect(store.sessions.find((row) => row.id === continuation.id)!.continuationOf).toBe(
      original.id,
    );
  });

  it("refuses continuation while the original row is not stopped — derived, not claimed", async () => {
    const { prisma, store } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const original = await createCodingSession(deps, baseInput);
    await expect(
      continueCodingSession(deps, {
        originalSessionId: original.id,
        targetEngine: "omp",
        label: "engine-change",
        handoffSummary: "state",
      }),
    ).rejects.toBeInstanceOf(ContinuationRefusedError);
    // Nothing partial: the workspace still belongs to the original session.
    expect(store.sessions).toHaveLength(1);
    expect(store.leases[0]!.sessionId).toBe(original.id);
  });

  it("a mid-sequence throw leaves no partial continuation (one transaction, rollback on throw)", async () => {
    const { prisma, store } = fakePrisma({
      failSessionUpdateWhen: (data) => "continuationOf" in data,
    });
    const deps = createSessionServiceDeps({ prisma });
    const original = await createCodingSession(deps, baseInput);
    await releaseCodingSession(deps, { sessionId: original.id });

    await expect(
      continueCodingSession(deps, {
        originalSessionId: original.id,
        targetEngine: "omp",
        label: "engine-change",
        handoffSummary: "auth refactor state",
      }),
    ).rejects.toThrow(/injected mid-transaction crash/);

    // Rollback restored the pre-call store exactly: no continuation session,
    // no lease, and the original carries no continuation provenance.
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]).toMatchObject({
      id: original.id,
      status: "stopped",
      engine: "normal-pi",
    });
    expect(store.sessions[0]!.engineChangeLabel).toBeUndefined();
    expect(store.sessions[0]!.handoffSummary).toBeUndefined();
    expect(store.leases).toHaveLength(0);
  });
});
