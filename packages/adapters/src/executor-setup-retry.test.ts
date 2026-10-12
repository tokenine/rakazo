import { describe, expect, it, vi } from "vitest";
import { finalizeRunSetupFailure, runSetupRetryDecision } from "./executor-setup-retry.js";

describe("runSetupRetryDecision", () => {
  it("retries while the setup failure count is under the cap", () => {
    expect(runSetupRetryDecision(0, false)).toBe("retry");
    expect(runSetupRetryDecision(1, false)).toBe("retry");
  });

  it("fails the run once the setup failure cap is reached", () => {
    expect(runSetupRetryDecision(2, false)).toBe("fail");
    expect(runSetupRetryDecision(5, false)).toBe("fail");
  });

  it("always retries busy-computer and database-capacity failures", () => {
    expect(runSetupRetryDecision(0, true)).toBe("retry");
    expect(runSetupRetryDecision(9, true)).toBe("retry");
  });
});

describe("finalizeRunSetupFailure", () => {
  const ctx = {
    run: {
      id: "run-1",
      spaceId: "space-1",
      threadId: "thread-1",
      botId: "bot-1",
      userId: "user-1",
      taskId: "task-1",
      trigger: "created",
      sourceMessageId: null,
    },
    bot: { id: "bot-1", name: "Helper" },
    attemptId: "attempt-1",
    workerId: "worker-1",
    fence: 1,
  };

  function depsWith(overrides?: { finalizeResult?: unknown }) {
    const finalizeRun = vi.fn(async () => overrides?.finalizeResult ?? { continuationRunId: null });
    const deps = {
      prisma: {},
      events: { finalizeRun },
      jobs: { enqueue: vi.fn(async () => undefined) },
      notifications: undefined,
    };
    return {
      deps: deps as unknown as Parameters<typeof finalizeRunSetupFailure>[0],
      finalizeRun,
    };
  }

  it("finalizes the run as failed with the underlying error message", async () => {
    const { deps, finalizeRun } = depsWith();
    await finalizeRunSetupFailure(deps, ctx, "sandbox provision failed: 500 no such image");
    expect(finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        outcome: "failed",
        error: "sandbox provision failed: 500 no such image",
        leaseOwner: "worker-1",
        leaseFence: 1,
      }),
    );
  });

  it("does not enqueue a continuation when no steering continuation exists", async () => {
    const { deps, finalizeRun } = depsWith({ finalizeResult: false });
    await finalizeRunSetupFailure(deps, ctx, "boom");
    expect(finalizeRun).toHaveBeenCalledTimes(1);
  });

  it("enqueues the steering continuation when finalize reports one", async () => {
    const { deps } = depsWith({ finalizeResult: { continuationRunId: "run-2" } });
    await finalizeRunSetupFailure(deps, ctx, "boom");
    expect(deps.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run.continue", payload: { runId: "run-2" } }),
    );
  });
});
