/**
 * T34 RED — production engine registry wiring and engine-keyed dispatch.
 *
 * Verifies:
 *  1. createSessionServiceDeps accepts a registry dep.
 *  2. CodingSession creation refuses when the engine has no registered adapter
 *     (EngineUnavailableError — V15 exact-match, no fallback).
 *  3. dispatchSessionOp routes by session.engine field.
 *
 * RED: registry is NOT passed to createSessionServiceDeps in the worker
 *      composition root; session creation with a missing adapter is not tested;
 *      dispatch is not verified to be engine-keyed.
 *
 * GREEN: buildEngineRegistry composed in worker; registry wired into session
 *        service deps; unknown-engine creation throws EngineUnavailableError.
 */

import { describe, expect, it } from "vitest";
import {
  createEngineRegistry,
  createCodingSessionRef,
  dispatchSessionOp,
  type CodingEngineAdapter,
  type CodingSessionOp,
} from "./coding-engine.js";
import {
  createCodingSession,
  createSessionServiceDeps,
  EngineUnavailableError,
} from "./coding-session-service.js";

// ---------------------------------------------------------------------------
// Fake prisma — minimal, supports $transaction + session + lease CRUD
// ---------------------------------------------------------------------------

function fakePrisma() {
  const sessions: Array<Record<string, unknown>> = [];
  const leases: Array<Record<string, unknown>> = [];

  const store = { sessions, leases };

  // The prisma client used directly by createSessionServiceDeps / createCodingSession
  const directClient = {
    codingSession: {
      findUnique: async ({ where }: { where: { id?: string; latestRunId?: string } }) => {
        if (where?.id) return sessions.find((s) => s.id === where.id) ?? null;
        if (where?.latestRunId) return sessions.find((s) => s.latestRunId === where.latestRunId) ?? null;
        return null;
      },
      findFirst: async () => null,
      create: async ({ data }: { data?: Record<string, unknown> }) => {
        const d: Record<string, unknown> = data ?? {};
        const row: Record<string, unknown> = { acceptance: null, refusals: 0, latestRunId: null, status: "active", ...d };
        row.id = (d.id as string | undefined) ?? `session-${sessions.length + 1}`;
        sessions.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = sessions.find((s) => s.id === where.id);
        if (!row) throw new Error("session not found");
        Object.assign(row, data);
        return row;
      },
    },
    codingWorkspaceLease: {
      findUnique: async ({ where }: { where: { workspaceId: string } }) =>
        leases.find((l) => l.workspaceId === where.workspaceId) ?? null,
      findFirst: async () => leases[0] ?? null,
      create: async ({ data }: { data?: Record<string, unknown> }) => {
        const d = data ?? {};
        const row: Record<string, unknown> = { ...d };
        leases.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: { workspaceId: string }; data?: Record<string, unknown> }) => {
        const idx = leases.findIndex((l) => l.workspaceId === where.workspaceId);
        if (idx >= 0) Object.assign(leases[idx]!, data ?? {});
        return { count: idx >= 0 ? 1 : 0 };
      },
    },
  };

  // PrismaClient proxy that routes $transaction to directClient
  const prisma = new Proxy(directClient, {
    get(target, prop) {
      if (prop === "$transaction") {
        return async <T>(fn: (tx: typeof directClient) => Promise<T>) => fn(target);
      }
      return (target as Record<string, unknown>)[prop as string];
    },
  }) as unknown as import("@rakazo/db").PrismaClient;

  return { prisma, store };
}

// ---------------------------------------------------------------------------
// Fake adapter factory
// ---------------------------------------------------------------------------

const allOps: CodingSessionOp[] = ["prompt", "steer", "stop", "resume", "inspect_changes", "approvals"];

function fakeAdapter(id: "normal-pi" | "omp", supportedOps: CodingSessionOp[] = allOps): CodingEngineAdapter {
  return { id, supportedOps: new Set(supportedOps), describe: () => `fake-${id}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("T34 RED: engine registry in production composition", () => {
  it("createSessionServiceDeps accepts a registry dep", () => {
    const { prisma } = fakePrisma();
    const registry = createEngineRegistry([fakeAdapter("normal-pi")]);
    const deps = createSessionServiceDeps({ prisma, registry });
    expect(deps.registry).toBe(registry);
  });

  it("creates a session when the engine has a registered adapter", async () => {
    const { prisma } = fakePrisma();
    const registry = createEngineRegistry([fakeAdapter("normal-pi")]);
    const deps = createSessionServiceDeps({ prisma, registry });
    const session = await createCodingSession(deps, {
      workspaceId: "ws-1",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });
    expect(session.engine).toBe("normal-pi");
  });

  it("REFUSES creation when registry is provided but engine has NO registered adapter (V15)", async () => {
    const { prisma } = fakePrisma();
    // Registry has only normal-pi — no omp adapter registered.
    const registry = createEngineRegistry([fakeAdapter("normal-pi")]);
    const deps = createSessionServiceDeps({ prisma, registry });
    // Creating an omp session with no omp adapter must throw EngineUnavailableError.
    await expect(
      createCodingSession(deps, {
        workspaceId: "ws-1",
        engine: "omp",
        spaceId: "space-1",
        userId: "user-1",
        botId: "bot-1",
      }),
    ).rejects.toBeInstanceOf(EngineUnavailableError);
  });

  it("dispatchSessionOp routes to the correct engine adapter by session.engine field", async () => {
    const registry = createEngineRegistry([fakeAdapter("normal-pi"), fakeAdapter("omp")]);
    const piSession = createCodingSessionRef({ id: "s-pi", workspaceId: "ws-1", engine: "normal-pi" });
    const ompSession = createCodingSessionRef({ id: "s-omp", workspaceId: "ws-2", engine: "omp" });

    const piSeen: string[] = [];
    const ompSeen: string[] = [];

    await dispatchSessionOp(registry, piSession, "prompt", async (adapter) => {
      piSeen.push(adapter.id);
      return "done";
    });
    await dispatchSessionOp(registry, ompSession, "prompt", async (adapter) => {
      ompSeen.push(adapter.id);
      return "done";
    });

    expect(piSeen).toEqual(["normal-pi"]);
    expect(ompSeen).toEqual(["omp"]);
  });

  it("dispatchSessionOp throws when session.engine has no registered adapter", async () => {
    const registry = createEngineRegistry([fakeAdapter("normal-pi")]);
    const ompSession = createCodingSessionRef({ id: "s-omp", workspaceId: "ws-1", engine: "omp" });
    await expect(
      dispatchSessionOp(registry, ompSession, "prompt", async () => "done"),
    ).rejects.toThrow(/No adapter is registered/i);
  });
});
