/**
 * 004-code-mode S4 — T22/T23/T26 RED→GREEN tests.
 *
 * T22 (V6): disconnect/reconnect — server-owned run continues, reconnect shows
 *   pending approvals, no duplicate run.
 * T23 (V6): crash reconciliation — workspace dirty-set + last recorded action
 *   reported before retry; stopped ≠ success.
 * T26 (V15): labelled continuation — original stopped, labelled engine-change
 *   continuation, history preserved.
 *
 * RED: module doesn't exist or functions return wrong types.
 * GREEN: after implementing coding-session-continuity.ts.
 */

import { runContinueJob } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { createCodingSessionRef, ENGINE_CHANGE_LABEL, planContinuation } from "./coding-engine.js";
import {
  getCodingSessionApprovals,
  getCodingSessionResumeData,
  getCrashReconciliationData,
} from "./coding-session-continuity.js";
import { createCodingSession, createSessionServiceDeps } from "./coding-session-service.js";

// ─── Fake Prisma double ──────────────────────────────────────────────────────

type FakeStore = {
  sessions: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  effects: Array<Record<string, unknown>>;
  steeringMessages: Array<Record<string, unknown>>;
};

function fakePrisma(): { prisma: PrismaClient; store: FakeStore } {
  const store: FakeStore = {
    sessions: [],
    runs: [],
    tasks: [],
    leases: [],
    effects: [],
    steeringMessages: [],
  };

  const uniqueViolation = () => {
    const error = new Error("Unique constraint failed") as Error & { code: string };
    error.code = "P2002";
    return error;
  };

  const base = {
    codingSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          acceptance: null,
          refusals: 0,
          latestRunId: null,
          verification: null,
          secretsAuditHead: null,
          continuationOf: null,
          engineChangeLabel: null,
          handoffSummary: null,
          status: "active",
          ...data,
          id: (data.id as string | undefined) ?? `session-${store.sessions.length + 1}`,
        };
        store.sessions.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.sessions.find((r) => r.id === where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        store.sessions.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.sessions.find((r) => r.id === where.id);
        if (!row) throw new Error("session not found");
        Object.assign(row, data);
        return row;
      },
    },
    codingWorkspaceLease: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (store.leases.some((l) => l.workspaceId === data.workspaceId)) {
          throw uniqueViolation();
        }
        store.leases.push({ ...data });
        return data;
      },
      findUnique: async ({ where }: { where: { workspaceId: string } }) =>
        store.leases.find((l) => l.workspaceId === where.workspaceId) ?? null,
      findFirst: async ({ where }: { where: { sessionId: string } }) =>
        store.leases.find((l) => l.sessionId === where.sessionId) ?? null,
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
        const lease = store.leases.find((l) => l.workspaceId === where.workspaceId);
        if (!lease) return { count: 0 };
        if (where.sessionId !== undefined && lease.sessionId !== where.sessionId)
          return { count: 0 };
        if (where.fence !== undefined && lease.fence !== where.fence) return { count: 0 };
        Object.assign(lease, data);
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: { sessionId: string; fence?: number } }) => {
        let removed = 0;
        for (let i = store.leases.length - 1; i >= 0; i--) {
          const l = store.leases[i]!;
          if (
            l.sessionId === where.sessionId &&
            (where.fence === undefined || l.fence === where.fence)
          ) {
            store.leases.splice(i, 1);
            removed++;
          }
        }
        return { count: removed };
      },
    },
    run: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          trigger: "manual",
          status: "queued",
          checkpoint: null,
          error: null,
          startedAt: null,
          completedAt: null,
          ...data,
          id: (data.id as string | undefined) ?? `run-${store.runs.length + 1}`,
        };
        store.runs.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.runs.find((r) => r.id === where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        store.runs.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const r of store.runs) {
          if (Object.entries(where).every(([k, v]) => r[k] === v)) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      },
    },
    task: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data };
        store.tasks.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.tasks.find((t) => t.id === where.id) ?? null,
    },
    externalEffect: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        store.effects.filter((e) => Object.entries(where).every(([k, v]) => e[k] === v)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          id: (data.id as string | undefined) ?? `effect-${store.effects.length + 1}`,
        };
        store.effects.push(row);
        return row;
      },
    },
    steeringMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => data,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const matches = store.steeringMessages.filter((e) =>
          Object.entries(where).every(([k, v]) => e[k] === v),
        );
        return (matches[matches.length - 1] as Record<string, unknown> | null) ?? null;
      },
    },
  };

  // Build the prisma object with $transaction that calls back into base
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaObj = {
    ...base,
    $transaction: async (work: (c: unknown) => Promise<unknown>) => work(base as unknown),
  };

  return { prisma: prismaObj as unknown as PrismaClient, store };
}

// ─── T22: Disconnect/reconnect ──────────────────────────────────────────────

describe("T22: disconnect/reconnect (V6)", () => {
  it("resume enqueues the runContinue job for the latest run", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-1",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    await prisma.task.create({
      data: {
        id: "task-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        userId: "user-1",
        prompt: "hello",
        status: "queued",
      },
    });
    await prisma.run.create({
      data: {
        id: "run-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        taskId: "task-1",
        userId: "user-1",
        status: "queued",
        trigger: "coding_session",
      },
    });
    await prisma.codingSession.update({
      where: { id: session.id },
      data: { latestRunId: "run-1" },
    });

    const resumeData = await getCodingSessionResumeData(deps, {
      sessionId: session.id,
    });
    expect(resumeData.runId).toBe("run-1");

    // Verify the job shape the caller would use
    const runJob = runContinueJob("run-1");
    expect(runJob.name).toBe("run.continue");
    if ("runId" in runJob.payload) {
      expect(runJob.payload.runId).toBe("run-1");
    } else {
      expect.fail("expected runContinue job payload to have runId");
    }
  });

  it("no duplicate run on reconnect — same runId returned for a reconnect", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-2",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    await prisma.task.create({
      data: {
        id: "task-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        userId: "user-1",
        prompt: "x",
        status: "queued",
      },
    });
    await prisma.run.create({
      data: {
        id: "run-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        taskId: "task-1",
        userId: "user-1",
        status: "running",
        trigger: "coding_session",
      },
    });
    await prisma.codingSession.update({
      where: { id: session.id },
      data: { latestRunId: "run-1" },
    });

    const first = await getCodingSessionResumeData(deps, {
      sessionId: session.id,
    });
    const second = await getCodingSessionResumeData(deps, {
      sessionId: session.id,
    });

    expect(first.runId).toBe(second.runId);
    expect(first.runId).toBe("run-1");
  });

  it("pending approvals are visible via getCodingSessionApprovals", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-3",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    await prisma.task.create({
      data: {
        id: "task-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        userId: "user-1",
        prompt: "x",
        status: "queued",
      },
    });
    await prisma.run.create({
      data: {
        id: "run-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        taskId: "task-1",
        userId: "user-1",
        status: "running",
        trigger: "coding_session",
      },
    });
    await prisma.codingSession.update({
      where: { id: session.id },
      data: { latestRunId: "run-1" },
    });

    await prisma.externalEffect.create({
      data: {
        id: "effect-1",
        spaceId: "space-1",
        runId: "run-1",
        kind: "shell",
        status: "pending",
        idempotencyKey: "key-1",
        request: { command: "rm -rf /" },
      },
    });

    const approvals = await getCodingSessionApprovals(deps, {
      sessionId: session.id,
    });

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ id: "effect-1", status: "pending" });
  });
});

// ─── T23: Crash reconciliation ─────────────────────────────────────────────

describe("T23: crash reconciliation (V6)", () => {
  it("getCrashReconciliationData returns session, run, outcome for a stopped run", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-4",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    await prisma.task.create({
      data: {
        id: "task-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        userId: "user-1",
        prompt: "x",
        status: "cancelled",
      },
    });
    await prisma.run.create({
      data: {
        id: "run-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        taskId: "task-1",
        userId: "user-1",
        status: "cancelled",
        completedAt: new Date(),
        trigger: "coding_session",
      },
    });
    await prisma.codingSession.update({
      where: { id: session.id },
      data: { latestRunId: "run-1" },
    });

    const result = await getCrashReconciliationData(deps, {
      sessionId: session.id,
    });

    expect(result.sessionId).toBe(session.id);
    expect(result.runId).toBe("run-1");
    expect(result.outcome).toBe("cancelled");
    expect(result.isSuccess).toBe(false);
  });

  it("stopped status is NOT success — isSuccess is false for cancelled/failed", async () => {
    const { prisma } = fakePrisma();
    const deps = createSessionServiceDeps({ prisma });

    const session = await createCodingSession(deps, {
      workspaceId: "ws-5",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
    });

    await prisma.task.create({
      data: {
        id: "task-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        userId: "user-1",
        prompt: "x",
        status: "failed",
      },
    });
    await prisma.run.create({
      data: {
        id: "run-1",
        spaceId: "space-1",
        botId: "bot-1",
        threadId: "thread-1",
        taskId: "task-1",
        userId: "user-1",
        status: "failed",
        completedAt: new Date(),
        trigger: "coding_session",
      },
    });
    await prisma.codingSession.update({
      where: { id: session.id },
      data: { latestRunId: "run-1" },
    });

    const result = await getCrashReconciliationData(deps, {
      sessionId: session.id,
    });

    expect(result.isSuccess).toBe(false);
    expect(["cancelled", "failed", "stopped"].some((s) => result.outcome === s)).toBe(true);
  });
});

// ─── T26: Labelled continuation (V15) ─────────────────────────────────────

describe("T26: labelled continuation (V15)", () => {
  it("same-engine continuation is allowed with optional handoff summary", () => {
    const original = createCodingSessionRef({
      id: "session-same-engine",
      workspaceId: "ws-continue",
      engine: "normal-pi",
    });

    const plan = planContinuation({
      originalSession: original,
      originalRunStopped: true,
      targetEngine: "normal-pi",
      handoffSummary: "WIP: auth refactor",
    });

    expect(plan.engineChanged).toBe(false);
    expect(plan.nextSession.engine).toBe("normal-pi");
    expect(plan.handoffSummary).toBe("WIP: auth refactor");
    expect(plan.nextSession.id).not.toBe(original.id);
  });

  it("labelled engine-change requires ENGINE_CHANGE_LABEL + handoff summary", () => {
    const original = createCodingSessionRef({
      id: "session-engine-change",
      workspaceId: "ws-engine",
      engine: "normal-pi",
    });

    // Without label → refused
    expect(() =>
      planContinuation({
        originalSession: original,
        originalRunStopped: true,
        targetEngine: "omp",
        handoffSummary: "state",
      }),
    ).toThrow();

    // With correct label + handoff → accepted
    const plan = planContinuation({
      originalSession: original,
      originalRunStopped: true,
      targetEngine: "omp",
      label: ENGINE_CHANGE_LABEL,
      handoffSummary: "OMP session state",
    });

    expect(plan.engineChanged).toBe(true);
    expect(plan.label).toBe(ENGINE_CHANGE_LABEL);
    expect(plan.nextSession.engine).toBe("omp");
  });

  it("original run must be stopped first", () => {
    const original = createCodingSessionRef({
      id: "session-active",
      workspaceId: "ws-active",
      engine: "normal-pi",
    });

    expect(() =>
      planContinuation({
        originalSession: original,
        originalRunStopped: false,
        targetEngine: "normal-pi",
        handoffSummary: "continue",
      }),
    ).toThrow();
  });

  it("engine-internal state never crosses: continuation plan has no engine-internal fields", () => {
    const original = createCodingSessionRef({
      id: "session-iso",
      workspaceId: "ws-iso",
      engine: "normal-pi",
    });

    const plan = planContinuation({
      originalSession: original,
      originalRunStopped: true,
      targetEngine: "omp",
      label: ENGINE_CHANGE_LABEL,
      handoffSummary: "only handoff text",
    });

    expect(Object.keys(plan).sort()).toEqual([
      "engineChanged",
      "handoffSummary",
      "label",
      "nextSession",
    ]);
  });
});
