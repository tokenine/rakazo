import { runContinueJob } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { EngineMismatchError } from "./coding-engine.js";
import { createCodingPiAdapter } from "./coding-pi-adapter.js";
import { LeaseLostError } from "./coding-session-service.js";

interface RunRow {
  id: string;
  taskId: string;
  status: string;
  trigger: string;
  userId: string;
  botId: string;
  spaceId: string;
  threadId: string;
  prompt: string;
  completedAt?: Date;
}

function fakePrisma() {
  const sessions: Array<Record<string, unknown>> = [];
  const runs: RunRow[] = [];
  const tasks: Array<Record<string, unknown>> = [];
  const steering: Array<Record<string, unknown>> = [];
  const leases: Array<Record<string, unknown>> = [];
  const pendingEffects = [{ id: "effect-1", kind: "shell", status: "pending", runId: "run-1" }];
  const prisma = {
    codingSession: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        sessions.find((row) => row.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: unknown }) => {
        Object.assign(sessions.find((row) => row.id === where.id)!, data);
        return sessions.find((row) => row.id === where.id);
      },
    },
    task: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `task-${tasks.length + 1}`, ...data };
        tasks.push(row);
        return row;
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        for (const task of tasks) Object.assign(task, data);
        return { count: tasks.length };
      },
    },
    run: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `run-${runs.length + 1}`, leaseFence: 0, ...data } as unknown as RunRow;
        runs.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: { id?: string; status?: { in: string[] } } }) =>
        runs.find(
          (row) =>
            (!where.id || row.id === where.id) &&
            (!where.status?.in || where.status.in.includes(row.status)),
        ) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: { in: string[] } };
        data: Partial<RunRow> & { completedAt?: Date };
      }) => {
        const row = runs.find(
          (entry) =>
            entry.id === where.id && (!where.status?.in || where.status.in.includes(entry.status)),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    steeringMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `steer-${steering.length + 1}`, ...data };
        steering.push(row);
        return row;
      },
    },
    externalEffect: {
      findMany: async ({ where }: { where: { runId?: string; status?: string } }) =>
        pendingEffects.filter(
          (effect) =>
            (!where.runId || effect.runId === where.runId) &&
            (!where.status || effect.status === where.status),
        ),
    },
    codingWorkspaceLease: {
      findUnique: async ({ where }: { where: { workspaceId: string } }) =>
        leases.find((lease) => lease.workspaceId === where.workspaceId) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { workspaceId: string; sessionId?: string; fence?: number };
        data: Record<string, unknown>;
      }) => {
        const lease = leases.find((entry) => entry.workspaceId === where.workspaceId);
        if (!lease) return { count: 0 };
        if (where.sessionId !== undefined && lease.sessionId !== where.sessionId) {
          return { count: 0 };
        }
        if (where.fence !== undefined && lease.fence !== where.fence) {
          return { count: 0 };
        }
        for (const key of Object.keys(data)) {
          lease[key] = data[key];
        }
        return { count: 1 };
      },
    },
    $transaction: async (work: (client: unknown) => Promise<unknown>) => work(prisma),
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    store: { sessions, runs, tasks, steering, pendingEffects, leases },
  };
}

function fakeMachinery() {
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
    continued,
    aborted,
  };
  return machinery;
}

function fakeJobs() {
  const enqueued: Array<{ name: string; payload: unknown }> = [];
  return {
    enqueued,
    jobs: {
      enqueue: async (job: { name: string; payload: unknown }) => {
        enqueued.push(job);
      },
      cancel: async () => undefined,
      close: async () => undefined,
    },
  };
}

function fakeEvents() {
  const appended: Array<{ type: string; runId?: string; payload?: unknown }> = [];
  return {
    appended,
    events: {
      append: async (event: { type: string; runId?: string; payload?: unknown }) => {
        appended.push(event);
        return event;
      },
    },
  };
}

const sessionRow = {
  id: "session-1",
  workspaceId: "ws-1",
  engine: "normal-pi",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  threadId: "thread-1",
  status: "active",
  latestRunId: null,
};

async function wired() {
  const { prisma, store } = fakePrisma();
  store.sessions.push({ ...sessionRow });
  // The session holds its workspace lease (as createCodingSession leaves it).
  store.leases.push({
    workspaceId: "ws-1",
    sessionId: "session-1",
    owner: "user-1",
    fence: 1,
    // Held and live, but close to lapsing: renewal must slide it forward.
    expiresAt: new Date(Date.now() + 60_000),
  });
  const machinery = fakeMachinery();
  const { jobs, enqueued } = fakeJobs();
  const { events, appended } = fakeEvents();
  const adapter = createCodingPiAdapter({
    prisma,
    jobs,
    events,
    machinery,
    workerId: "worker-1",
    inspectChanges: async () => ({ messages: [], toolResults: [] }),
  });
  return { adapter, store, machinery, enqueued, appended, prisma };
}

const session = {
  id: "session-1",
  workspaceId: "ws-1",
  engine: "normal-pi" as const,
};

describe("normal-pi coding adapter rides the existing run machinery (V1 pi, T3)", () => {
  it("prompt creates the run through the existing Task+Run shapes and wakes the executor", async () => {
    const { adapter, store, enqueued, appended } = await wired();
    const result = await adapter.dispatch<{ runId: string; steered: boolean }>(session, "prompt", {
      text: "implement the login page",
      messageId: "message-1",
    });
    expect(result.runId).toBe("run-1");
    expect(store.runs[0]).toMatchObject({
      id: "run-1",
      status: "queued",
      trigger: "coding_session",
      userId: "user-1",
      botId: "bot-1",
      spaceId: "space-1",
      threadId: "thread-1",
    });
    expect(store.tasks[0]).toMatchObject({ status: "queued", prompt: "implement the login page" });
    expect(enqueued).toEqual([runContinueJob("run-1")]);
    expect(store.sessions[0]!.latestRunId).toBe("run-1");
    expect(appended.some((event) => event.type === "coding_session.prompted")).toBe(true);
    // The adapter only enqueues; the executor claims the run via its lease/fence path.
    expect(store.runs[0]!.status).toBe("queued");
  });

  it("prompt during an active run becomes steering against that run — no new run", async () => {
    const { adapter, store, enqueued } = await wired();
    const first = await adapter.dispatch<{ runId: string }>(session, "prompt", {
      text: "implement the login page",
      messageId: "message-1",
    });
    store.runs[0]!.status = "running";
    const second = await adapter.dispatch<{ runId: string; steered: boolean }>(session, "prompt", {
      text: "focus on the form validation",
      messageId: "message-2",
    });
    expect(second.runId).toBe(first.runId);
    expect(second.steered).toBe(true);
    expect(store.runs).toHaveLength(1);
    expect(store.steering).toEqual([
      expect.objectContaining({
        messageId: "message-2",
        botId: "bot-1",
        userId: "user-1",
        runId: "run-1",
      }),
    ]);
    expect(enqueued).toEqual([runContinueJob("run-1")]);
  });

  it("stop cancels the active run with the existing cancel shape and aborts the runtime", async () => {
    const { adapter, store, machinery, appended } = await wired();
    await adapter.dispatch(session, "prompt", { text: "work", messageId: "message-1" });
    store.runs[0]!.status = "running";
    const result = await adapter.dispatch<{ stopped: boolean }>(session, "stop", {});
    expect(result.stopped).toBe(true);
    expect(store.runs[0]).toMatchObject({ status: "cancelled" });
    expect(store.runs[0]!.completedAt).toBeInstanceOf(Date);
    expect(store.tasks[0]).toMatchObject({ status: "cancelled" });
    expect(machinery.aborted).toEqual(["run-1"]);
    expect(appended.some((event) => event.type === "coding_session.stopped")).toBe(true);
  });

  it("stop on a terminal run is a no-op, not an error", async () => {
    const { adapter, store, machinery } = await wired();
    await adapter.dispatch(session, "prompt", { text: "work", messageId: "message-1" });
    store.runs[0]!.status = "completed";
    const result = await adapter.dispatch<{ stopped: boolean }>(session, "stop", {});
    expect(result.stopped).toBe(false);
    expect(machinery.aborted).toEqual([]);
  });

  it("resume wakes the existing run through the run.continue job — no new run row", async () => {
    const { adapter, store, enqueued } = await wired();
    await adapter.dispatch(session, "prompt", { text: "work", messageId: "message-1" });
    store.runs[0]!.status = "waiting_input";
    const result = await adapter.dispatch<{ resumed: boolean }>(session, "resume", {});
    expect(result.resumed).toBe(true);
    expect(store.runs).toHaveLength(1);
    expect(enqueued).toEqual([runContinueJob("run-1"), runContinueJob("run-1")]);
  });

  it("inspect changes delegates to the workspace diff provider", async () => {
    const { adapter } = await wired();
    const result = await adapter.dispatch<{ files: Array<{ path: string; status: string }> }>(
      session,
      "inspect_changes",
      {},
    );
    expect(result).toEqual({ files: [{ path: "src/a.ts", status: "modified" }] });
  });

  it("approvals surfaces pending approval effects for the session's run", async () => {
    const { adapter } = await wired();
    await adapter.dispatch(session, "prompt", { text: "work", messageId: "message-1" });
    const result = await adapter.dispatch<{ pending: Array<{ id: string; status: string }> }>(
      session,
      "approvals",
      {},
    );
    expect(result.pending).toEqual([
      expect.objectContaining({ id: "effect-1", status: "pending" }),
    ]);
  });

  it("dispatch goes through the engine registry: an omp session cannot run pi machinery silently", async () => {
    const { adapter } = await wired();
    const error = await adapter
      .dispatch({ id: "session-omp", workspaceId: "ws-1", engine: "omp" }, "prompt", {
        text: "work",
        messageId: "message-1",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EngineMismatchError);
  });

  it("registers only as normal-pi in the engine registry", async () => {
    const { adapter } = await wired();
    expect(adapter.id).toBe("normal-pi");
    expect(adapter.describe()).toMatch(/normal-pi/);
  });
});

describe('session rows without a threadId refuse instead of fabricating "null" (LOW-4 fix)', () => {
  it("prompt refuses with an explicit threadId error and creates no task/run/job", async () => {
    const { adapter, store, enqueued, appended } = await wired();
    store.sessions[0]!.threadId = null;
    await expect(
      adapter.dispatch(session, "prompt", { text: "work", messageId: "message-1" }),
    ).rejects.toThrow(/threadId/);
    expect(store.tasks).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
    expect(enqueued).toEqual([]);
    expect(appended).toEqual([]);
  });

  it("stop with an active run refuses at the event append instead of emitting a null threadId", async () => {
    const { adapter, store, appended } = await wired();
    await adapter.dispatch(session, "prompt", { text: "work", messageId: "message-1" });
    store.runs[0]!.status = "running";
    store.sessions[0]!.threadId = null;
    await expect(adapter.dispatch(session, "stop", {})).rejects.toThrow(/threadId/);
    // No stopped event may carry the fabricated "null" thread id (the
    // prompted event from the setup prompt above is the only one).
    expect(appended.some((event) => event.type === "coding_session.stopped")).toBe(false);
  });
});

describe("session activity revalidates and renews the workspace lease (MED-2 fix)", () => {
  it("prompt renews a held lease — the expiry slides forward", async () => {
    const { adapter, store } = await wired();
    const before = store.leases[0]!.expiresAt as Date;
    await adapter.dispatch(session, "prompt", { text: "work", messageId: "message-1" });
    const after = store.leases[0]!.expiresAt as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("prompt refuses with a typed error once the lease was lost — no run, no job", async () => {
    const { adapter, store, enqueued } = await wired();
    store.leases.length = 0;
    await expect(
      adapter.dispatch(session, "prompt", { text: "work", messageId: "message-1" }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(store.runs).toHaveLength(0);
    expect(store.tasks).toHaveLength(0);
    expect(enqueued).toEqual([]);
  });

  it("stop refuses once the lease was lost — the runtime is never aborted by a leaseless caller", async () => {
    const { adapter, store, machinery, appended } = await wired();
    await adapter.dispatch(session, "prompt", { text: "work", messageId: "message-1" });
    store.runs[0]!.status = "running";
    store.leases.length = 0;
    await expect(adapter.dispatch(session, "stop", {})).rejects.toBeInstanceOf(LeaseLostError);
    expect(machinery.aborted).toEqual([]);
    expect(appended.some((event) => event.type === "coding_session.stopped")).toBe(false);
  });
});
