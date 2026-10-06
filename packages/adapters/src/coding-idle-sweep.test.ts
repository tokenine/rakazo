/**
 * 004-code-mode S6 T30 — production caller for checkIdle (idle sweep).
 *
 * checkIdle had unit tests but zero production callers: idle coding sessions
 * never reached the existing sleepComputerIfIdle contract. The sweep runs
 * inside the periodic job reconciler (as an auxiliary reconciliation like
 * cloud agents and computer updates): it enumerates active coding sessions,
 * keeps the ones checkIdle marks idle, resolves each session's computer via
 * the same bot → computer mapping the T38 reconcileCrash path uses, and
 * invokes sleepComputerIfIdle. Per-session failures are logged and
 * non-fatal.
 *
 * sleepComputerIfIdle is mocked — the sweep only routes into it; its own
 * semantics are covered in computer-idle.test.ts.
 */

import type { SandboxProvider } from "@rakazo/adapter-kit";
import type { AgentHomeStore } from "@rakazo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sleepComputerIfIdle } from "./computer-idle.js";
import { createJobReconciler, reconcileIdleCodingSessions } from "./job-reconciler.js";

vi.mock("./computer-idle.js", () => ({ sleepComputerIfIdle: vi.fn(async () => undefined) }));

// The sleep mock is module-scoped by vi.mock — clear call history per test.
afterEach(() => {
  vi.clearAllMocks();
});

const IDLE_ROW_BASE = {
  status: "active",
  latestRunId: null,
  idleThresholdMinutes: 30,
  lastActivityAt: new Date(Date.now() - 31 * 60 * 1000),
};

function publisher() {
  const enqueue = vi.fn(async () => undefined);
  const jobs = { enqueue, cancel: async () => undefined, close: async () => undefined };
  return { jobs, enqueue };
}

function sweepDeps(prisma: PrismaClient) {
  const { jobs } = publisher();
  return {
    prisma,
    sandbox: {} as SandboxProvider,
    home: {} as AgentHomeStore,
    jobs,
    events: {} as ThreadEvents,
  };
}

function sweepPrisma(sessions: Array<Record<string, unknown>>): PrismaClient {
  return {
    run: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    routine: { findMany: vi.fn(async () => []) },
    computer: { findMany: vi.fn(async () => []) },
    messagingOutbound: { findFirst: vi.fn(async () => null) },
    codingSession: {
      findMany: vi.fn(async () => sessions),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        IDLE_ROW_BASE && sessions.some((s) => s.id === where.id)
          ? { ...IDLE_ROW_BASE, id: where.id }
          : null,
      ),
    },
    bot: { findUnique: vi.fn(async () => null) },
  } as unknown as PrismaClient;
}

describe("reconcileIdleCodingSessions (T30 S6)", () => {
  it("suspends the computer behind an idle coding session", async () => {
    const prisma = sweepPrisma([{ id: "s1", botId: "b1" }]);
    vi.mocked(prisma.bot.findUnique).mockResolvedValue({ computerId: "c1" } as never);
    const deps = sweepDeps(prisma);

    await reconcileIdleCodingSessions(deps);

    expect(sleepComputerIfIdle).toHaveBeenCalledWith(deps, "c1");
  });

  it("skips a session whose bot has no computer", async () => {
    const prisma = sweepPrisma([{ id: "s1", botId: "b1" }]);
    vi.mocked(prisma.bot.findUnique).mockResolvedValue({ computerId: null } as never);
    const deps = sweepDeps(prisma);

    await reconcileIdleCodingSessions(deps);

    expect(sleepComputerIfIdle).not.toHaveBeenCalled();
  });

  it("skips a session with an active run (checkIdle guard)", async () => {
    const prisma = sweepPrisma([{ id: "s1", botId: "b1" }]);
    vi.mocked(prisma.codingSession.findUnique).mockResolvedValue({
      ...IDLE_ROW_BASE,
      latestRunId: "run-1",
    } as never);
    vi.mocked(prisma.run.findFirst).mockResolvedValue({ id: "run-1", status: "running" } as never);
    const deps = sweepDeps(prisma);

    await reconcileIdleCodingSessions(deps);

    expect(sleepComputerIfIdle).not.toHaveBeenCalled();
  });

  it("skips a session with no recorded activity (checkIdle guard)", async () => {
    const prisma = sweepPrisma([{ id: "s1", botId: "b1" }]);
    vi.mocked(prisma.codingSession.findUnique).mockResolvedValue({
      ...IDLE_ROW_BASE,
      lastActivityAt: null,
    } as never);
    const deps = sweepDeps(prisma);

    await reconcileIdleCodingSessions(deps);

    expect(sleepComputerIfIdle).not.toHaveBeenCalled();
  });

  it("keeps sweeping when one session fails (per-session failures are non-fatal)", async () => {
    const prisma = sweepPrisma([
      { id: "s1", botId: "b1" },
      { id: "s2", botId: "b2" },
    ]);
    vi.mocked(prisma.bot.findUnique)
      .mockRejectedValueOnce(new Error("db hiccup"))
      .mockResolvedValueOnce({ computerId: "c2" } as never);
    const deps = sweepDeps(prisma);

    await reconcileIdleCodingSessions(deps);

    expect(sleepComputerIfIdle).toHaveBeenCalledTimes(1);
    expect(sleepComputerIfIdle).toHaveBeenCalledWith(deps, "c2");
  });

  it("runs with the periodic sweep and the main scans survive its failure", async () => {
    const idleSweep = vi.fn(async () => {
      throw new Error("sweep unavailable");
    });
    const prisma = {
      run: { findMany: vi.fn(async () => [{ id: "run-1", updatedAt: new Date() }]) },
      routine: { findMany: vi.fn(async () => []) },
      computer: { findMany: vi.fn(async () => []) },
      messagingOutbound: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const { jobs, enqueue } = publisher();

    await createJobReconciler({ prisma, jobs, reconcileIdleCodingSessions: idleSweep }).reconcileOnce();

    expect(idleSweep).toHaveBeenCalledOnce();
    // The failed sweep did not stop the run scan from being dispatched.
    expect(enqueue).toHaveBeenCalledWith({
      name: "run.continue",
      payload: { runId: "run-1" },
      replaceKey: "run:run-1",
    });
  });
});
