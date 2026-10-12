import { runContinueJob } from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import { returnBotMessageOutcome } from "./bot-messages.js";
import type { ExecutorDeps } from "./executor.js";
import { notifyRun } from "./executor.js";

/**
 * How many recorded setup failures a run tolerates before it is finalized as
 * failed instead of requeued. Permanent setup problems (a missing sandbox
 * image, a removed credential) otherwise loop through the job queue's default
 * retry budget — minutes of silent retries with nothing surfaced in the thread.
 */
export const RUN_SETUP_FAILURE_LIMIT = 3;

export function runSetupRetryDecision(
  priorSetupFailures: number,
  retryForever: boolean,
): "retry" | "fail" {
  if (retryForever) return "retry";
  return priorSetupFailures + 1 >= RUN_SETUP_FAILURE_LIMIT ? "fail" : "retry";
}

interface SetupFailureContext {
  run: {
    id: string;
    spaceId: string;
    threadId: string;
    botId: string;
    userId: string;
    taskId: string;
    trigger: string;
    sourceMessageId: string | null;
  };
  bot: { id: string; name: string };
  attemptId: string;
  workerId: string;
  fence: number;
}

/**
 * Finalize a run as failed with the caller-supplied (already redacted) error.
 * Shared by the pre-model failure path and the setup-failure cap so both write
 * the same run row, delegation return, and failure notification.
 */
export async function finalizeRunSetupFailure(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs" | "notifications">,
  ctx: SetupFailureContext,
  message: string,
): Promise<void> {
  const failed = await deps.events.finalizeRun({
    spaceId: ctx.run.spaceId,
    threadId: ctx.run.threadId,
    botId: ctx.bot.id,
    runId: ctx.run.id,
    taskId: ctx.run.taskId,
    attemptId: ctx.attemptId,
    leaseOwner: ctx.workerId,
    leaseFence: ctx.fence,
    outcome: "failed",
    error: message,
  });
  if (!failed) return;
  if (failed.continuationRunId) {
    await deps.jobs
      .enqueue(runContinueJob(failed.continuationRunId))
      .catch((error) => getLogger().error("steering continuation enqueue", error));
  }
  if (ctx.run.trigger === "bot_message") {
    await returnBotMessageOutcome(
      deps,
      { ...ctx.run, sourceMessageId: ctx.run.sourceMessageId },
      { id: ctx.bot.id, name: ctx.bot.name },
      `Could not complete the delegated request: ${message}`,
      "status",
    ).catch((error) => getLogger().error("bot message failure return", error));
  }
  if (!failed.continuationRunId) {
    await notifyRun(deps, ctx.run, {
      kind: "failure",
      title: `${ctx.bot.name} failed`,
      body: message.slice(0, 180),
      botId: ctx.bot.id,
      threadId: ctx.run.threadId,
    });
  }
}
