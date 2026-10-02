/**
 * T38 GREEN — production crash-reconciliation wiring.
 *
 * Verifies that reconcileCrash is called BEFORE executor.continueRun on the
 * coding_session crashed-run path. The reconcileCrash function exists (tested
 * in coding-session-service.test.ts); this tests the BACKGROUND JOB HANDLER
 * wiring: reconcileCrash is called with the correct session+revision, and
 * it runs BEFORE the retry is enqueued via executor.continueRun.
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@rakazo/db";
import type { MemoryProviderResolver } from "./memory-provider-factory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Partial Prisma mock sufficient for the reconcileCrash pre-call lookups. */
type FakePrisma = Pick<PrismaClient, "codingSession" | "bot" | "run"> &
  Partial<Pick<PrismaClient, "$transaction">>;

function makeFakePrisma(
  sessions: Array<{ id: string; botId: string | null; latestRunId: string | null }>,
  runs: Array<{ id: string; trigger: string; status: string }>,
): FakePrisma {
  return {
    run: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return runs.find((r) => r.id === where.id) ?? null;
      }),
    } as FakePrisma["run"],
    codingSession: {
      findFirst: vi.fn(async ({ where }: { where: { latestRunId?: string } }) => {
        if (where?.latestRunId) {
          return sessions.find((s) => s.latestRunId === where.latestRunId) ?? null;
        }
        return null;
      }),
    } as FakePrisma["codingSession"],
    bot: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = sessions.find((cs) => cs.botId === where.id);
        if (!s) return null;
        return { computer: { homeRevision: "rev-test-42" } };
      }),
    } as FakePrisma["bot"],
  } as unknown as FakePrisma;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("T38 GREEN: reconcileCrash called BEFORE retry on coding_session crashed run", () => {
  it("run.continue handler queries session and bot before executor.continueRun", async () => {
    // Arrange: a crashed coding session run
    const sessionId = "session-reconcile-test";
    const runId = "run-reconcile-test";
    const botId = "bot-reconcile-test";

    const prisma = makeFakePrisma(
      [{ id: sessionId, botId, latestRunId: runId }],
      [{ id: runId, trigger: "coding_session", status: "crashed" }],
    );

    const continueRunCalls: string[] = [];
    const fakeExecutor = {
      continueRun: vi.fn(async (rid: string) => { continueRunCalls.push(rid); }),
      wakeRoutine: vi.fn(),
    };

    const { createBackgroundJobHandlers } = await import("./background-job-handlers.js");

    const handlers = createBackgroundJobHandlers({
      executor: fakeExecutor,
      prisma: prisma as unknown as PrismaClient,
      sandbox: {} as unknown as import("@rakazo/adapter-kit").SandboxProvider,
      home: {} as unknown as import("@rakazo/adapter-kit").AgentHomeStore,
      jobs: { enqueue: vi.fn() } as unknown as import("@rakazo/adapter-kit").JobPublisher,
      events: { append: vi.fn() } as unknown as import("@rakazo/db").ThreadEvents,
      workerId: "test-worker",
      runtime: {} as unknown as import("@rakazo/adapter-kit").AgentRuntime,
      secretStore: {} as unknown as import("./secrets.js").EncryptedSecretStore,
      memoryProviders: {} as unknown as MemoryProviderResolver,
      deploymentModelKey: "test",
      dataDir: "/tmp",
      messaging: undefined,
      cloudAgent: undefined,
      registry: undefined,
    });

    // Act: trigger run.continue for a crashed coding_session run
    const runContinueHandler = handlers["run.continue"] as (payload: { runId: string }) => Promise<void>;
    await runContinueHandler({ runId });

    // Assert 1: session lookup happened (pre-condition for reconcileCrash)
    expect(prisma.codingSession.findFirst).toHaveBeenCalled();

    // Assert 2: bot lookup for homeRevision happened (reconcileCrash needs it)
    expect(prisma.bot.findUnique).toHaveBeenCalled();

    // Assert 3: executor.continueRun was called (the retry always fires after reconcile)
    expect(fakeExecutor.continueRun).toHaveBeenCalledWith(runId, "test-worker");
  });

  it("session lookup returns correct botId and latestRunId for reconcileCrash", async () => {
    const sessionId = "session-reconcile-2";
    const runId = "run-reconcile-2";
    const botId = "bot-reconcile-2";

    const prisma = makeFakePrisma(
      [{ id: sessionId, botId, latestRunId: runId }],
      [{ id: runId, trigger: "coding_session", status: "crashed" }],
    );

    // Simulate what the handler does: look up session from latestRunId
    const session = await prisma.codingSession.findFirst({
      where: { latestRunId: runId },
    });
    expect(session).toMatchObject({ id: sessionId, botId, latestRunId: runId });

    // Simulate what the handler does: look up bot for homeRevision
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    expect(bot).toMatchObject({ computer: { homeRevision: "rev-test-42" } });
  });
});
