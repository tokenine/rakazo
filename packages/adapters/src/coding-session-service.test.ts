import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import {
  ContinuationRefusedError,
  continueCodingSession,
  createCodingSession,
  createSessionServiceDeps,
  loadCodingSession,
  releaseCodingSession,
  type SessionServiceStore,
  WorkspaceBusyError,
} from "./coding-session-service.js";

/**
 * Minimal in-memory prisma double for the two coding tables. Emulates the
 * unique-constraint behavior the real DB enforces for the workspace lease.
 */
function fakePrisma() {
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
      findUnique: async ({ where }: { where: { workspaceId: string } }) =>
        store.leases.find((lease) => lease.workspaceId === where.workspaceId) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { workspaceId: string; expiresAt?: { lte: Date } };
        data: Record<string, unknown>;
      }) => {
        const lease = store.leases.find((entry) => entry.workspaceId === where.workspaceId);
        if (!lease) return { count: 0 };
        if (
          where.expiresAt?.lte &&
          (lease.expiresAt as Date).getTime() > where.expiresAt.lte.getTime()
        ) {
          return { count: 0 };
        }
        applyLeaseData(lease, data);
        return { count: 1 };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { workspaceId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const lease = store.leases.find((entry) => entry.workspaceId === where.workspaceId);
        if (!lease) {
          const row = { ...create };
          store.leases.push(row);
          return row;
        }
        applyLeaseData(lease, update);
        return lease;
      },
      deleteMany: async ({ where }: { where: { sessionId: string } }) => {
        let removed = 0;
        for (let index = store.leases.length - 1; index >= 0; index -= 1) {
          if (store.leases[index]!.sessionId === where.sessionId) {
            store.leases.splice(index, 1);
            removed += 1;
          }
        }
        return { count: removed };
      },
    },
    $transaction: async (work: (client: unknown) => Promise<unknown>) => work(prisma),
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

  it("reattach cannot change the engine — the binding is fixed for the session's life", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const created = await createCodingSession(deps, baseInput);
    const reattached = await loadCodingSession(deps, {
      sessionId: created.id,
      // Even if a stale client asks for another engine, the stored binding wins.
      requestedEngine: "omp" as never,
    });
    expect(reattached.engine).toBe("normal-pi");
  });

  it("an expired lease does not wedge the workspace: takeover bumps the fence", async () => {
    const { prisma, store } = fakePrisma();
    const stale = createSessionServiceDeps({
      prisma,
      now: () => new Date("2026-10-01T05:00:00Z"),
    });
    const original = await createCodingSession(stale, baseInput);
    const fenceBefore = store.leases[0]!.fence as number;
    // Time passes; the lease expires; a later attach takes over.
    const later = createSessionServiceDeps({
      prisma,
      now: () => new Date("2026-10-01T06:00:00Z"),
    });
    const reattached = await loadCodingSession(later, { sessionId: original.id });
    expect(reattached.workspaceId).toBe("ws-1");
    expect(store.leases[0]!.fence).toBeGreaterThan(fenceBefore);
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

describe("labelled continuation moves the workspace to the new session (V15 service path)", () => {
  it("stops the original session, transfers the lease, keeps history and engine binding", async () => {
    const { prisma, store } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const original = await createCodingSession(deps, baseInput);

    const continuation = await continueCodingSession(deps, {
      originalSessionId: original.id,
      originalRunStopped: true,
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
  });

  it("refuses continuation while the original run is active", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });
    const original = await createCodingSession(deps, baseInput);
    await expect(
      continueCodingSession(deps, {
        originalSessionId: original.id,
        originalRunStopped: false,
        targetEngine: "omp",
        label: "engine-change",
        handoffSummary: "state",
      }),
    ).rejects.toBeInstanceOf(ContinuationRefusedError);
  });
});
