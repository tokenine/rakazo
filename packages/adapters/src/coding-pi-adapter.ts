/**
 * 004-code-mode T3 — normal-Pi coding adapter.
 *
 * Reuses the existing run machinery; it does NOT fork the run lifecycle:
 * - prompt/resume create or wake Runs and enqueue the existing `run.continue`
 *   job (the executor's lease/fence claim at executor.ts:1102-1163 does the
 *   claiming — never this adapter);
 * - stop uses the existing cancel shape (status "cancelled" + completedAt +
 *   task cancellation, as in thread-target.ts) and aborts via the runtime;
 * - requeue/waiting state stays owned by the executor's requeue/resume path
 *   (executor.ts:4721-4739);
 * - approvals read the existing ExternalEffect surface.
 */

import { type JobPublisher, runContinueJob } from "@rakazo/adapter-kit";
import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import {
  type CodingEngineAdapter,
  type CodingSessionOp,
  type CodingSessionRef,
  createEngineRegistry,
  dispatchSessionOp,
} from "./coding-engine.js";

/** The slice of the existing machinery coding runs ride. */
export interface CodingRunMachinery {
  /** The executor's continueRun entry (lease/fence claim + run loop). */
  continueRun: (runId: string, workerId: string) => Promise<void>;
  /** The runtime abort for the run (as the API stop path does). */
  abortRun: (runId: string) => Promise<void>;
}

export interface CodingPiAdapterDeps {
  prisma: PrismaClient;
  jobs: Pick<JobPublisher, "enqueue">;
  /** Append-only slice of the thread-events surface (session events). */
  events: {
    append: (event: Parameters<ThreadEvents["append"]>[0]) => Promise<unknown>;
  };
  machinery: CodingRunMachinery;
  workerId: string;
  /** Workspace diff surface for inspect_changes (wired at integration time). */
  inspectChanges: () => Promise<unknown>;
  now?: () => Date;
}

export const CODING_SESSION_TRIGGER = "coding_session";

/**
 * LOW-4 (fix round): threadId is nullable on the session row, but the Task and
 * Run shapes and the thread-events surface need a REAL thread id. Mapping a
 * missing threadId with String() used to fabricate the string "null" — refuse
 * with an explicit error instead.
 */
function requiredThreadId(row: { threadId?: unknown }, sessionId: string): string {
  const value = row.threadId;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Coding session "${sessionId}" has no threadId; ` +
        `this operation needs a thread to attach the run and its events to.`,
    );
  }
  return value;
}

export interface CodingPiAdapter extends CodingEngineAdapter {
  dispatch<TResult>(
    session: CodingSessionRef,
    op: CodingSessionOp,
    payload: Record<string, unknown>,
  ): Promise<TResult>;
}

/** Ops the normal-Pi engine exposes in S1 — the complete workflow (R3). */
const PI_SUPPORTED_OPS: ReadonlySet<CodingSessionOp> = new Set<CodingSessionOp>([
  "prompt",
  "steer",
  "stop",
  "resume",
  "inspect_changes",
  "approvals",
]);

export function createCodingPiAdapter(deps: CodingPiAdapterDeps): CodingPiAdapter {
  const now = deps.now ?? (() => new Date());
  const registry = createEngineRegistry([
    {
      id: "normal-pi",
      supportedOps: PI_SUPPORTED_OPS,
      describe: () => "normal-pi coding adapter on the existing run machinery",
    },
  ]);

  const prompt = async (input: {
    session: CodingSessionRef;
    text: string;
    messageId: string;
    userId?: string;
  }) => {
    const runPrompt = input.text.trim();
    if (!runPrompt) throw new Error("prompt text is required");
    const committed = await deps.prisma.$transaction(async (tx) => {
      const sessionRow = await tx.codingSession.findUnique({
        where: { id: input.session.id },
      });
      if (!sessionRow) throw new Error(`Coding session "${input.session.id}" not found`);
      const active = sessionRow.latestRunId
        ? await tx.run.findFirst({
            where: {
              id: String(sessionRow.latestRunId),
              status: { in: [...ACTIVE_RUN_STATUSES] },
            },
          })
        : null;
      if (active) {
        return { steered: true as const, runId: active.id as string };
      }
      const threadId = requiredThreadId(sessionRow, input.session.id);
      const task = await tx.task.create({
        data: {
          spaceId: String(sessionRow.spaceId),
          botId: String(sessionRow.botId),
          threadId,
          userId: String(sessionRow.userId),
          prompt: runPrompt,
          status: "queued",
        },
      });
      const run = await tx.run.create({
        data: {
          spaceId: String(sessionRow.spaceId),
          botId: String(sessionRow.botId),
          threadId,
          taskId: task.id as string,
          userId: input.userId ?? String(sessionRow.userId),
          status: "queued",
          trigger: CODING_SESSION_TRIGGER,
          sourceMessageId: input.messageId,
        },
      });
      await tx.codingSession.update({
        where: { id: input.session.id },
        data: { latestRunId: run.id as string },
      });
      return { steered: false as const, runId: run.id as string };
    });
    if (committed.steered) {
      // Steering an active run: the run consumes SteeringMessage rows mid-turn.
      await deps.prisma.steeringMessage.create({
        data: {
          messageId: input.messageId,
          botId: await botIdForRun(committed.runId),
          userId: input.userId ?? (await userIdForRun(committed.runId)),
          runId: committed.runId,
        },
      });
      return { runId: committed.runId, steered: true };
    }
    await deps.events.append({
      spaceId: await spaceIdForSession(input.session.id),
      threadId: await threadIdForSession(input.session.id),
      botId: await botIdForSession(input.session.id),
      type: "coding_session.prompted",
      runId: committed.runId,
      payload: { sessionId: input.session.id, engine: input.session.engine },
    });
    // The worker (or tests) drives executor.continueRun from this job — the
    // adapter never claims the run itself.
    await deps.jobs.enqueue(runContinueJob(committed.runId));
    return { runId: committed.runId, steered: false };
  };

  const stop = async (input: { session: CodingSessionRef }) => {
    const sessionRow = await deps.prisma.codingSession.findUnique({
      where: { id: input.session.id },
    });
    const runId = sessionRow?.latestRunId ? String(sessionRow.latestRunId) : null;
    if (!runId) return { stopped: false };
    const cancelled = await deps.prisma.run.updateMany({
      where: { id: runId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      data: { status: "cancelled", completedAt: now() },
    });
    if (cancelled.count !== 1) return { stopped: false };
    const run = await deps.prisma.run.findFirst({ where: { id: runId } });
    if (run?.taskId) {
      await deps.prisma.task.updateMany({
        where: { id: String(run.taskId) },
        data: { status: "cancelled" },
      });
    }
    await deps.machinery.abortRun(runId);
    await deps.events.append({
      spaceId: await spaceIdForSession(input.session.id),
      threadId: await threadIdForSession(input.session.id),
      botId: await botIdForSession(input.session.id),
      type: "coding_session.stopped",
      runId,
      payload: { sessionId: input.session.id },
    });
    return { stopped: true };
  };

  const resume = async (input: { session: CodingSessionRef }) => {
    const sessionRow = await deps.prisma.codingSession.findUnique({
      where: { id: input.session.id },
    });
    const runId = sessionRow?.latestRunId ? String(sessionRow.latestRunId) : null;
    if (!runId) return { resumed: false };
    const run = await deps.prisma.run.findFirst({ where: { id: runId } });
    if (!run) return { resumed: false };
    // Executor.continueRun reclaims expired leases / resumes waiting runs —
    // including its requeue path — so enqueueing the existing job is the whole
    // resume story here.
    await deps.jobs.enqueue(runContinueJob(runId));
    return { resumed: true };
  };

  const approvals = async (input: { session: CodingSessionRef }) => {
    const sessionRow = await deps.prisma.codingSession.findUnique({
      where: { id: input.session.id },
    });
    const runId = sessionRow?.latestRunId ? String(sessionRow.latestRunId) : null;
    if (!runId) return { pending: [] };
    const pending = await deps.prisma.externalEffect.findMany({
      where: { runId, status: "pending" },
    });
    return { pending };
  };

  const steer = async (input: {
    session: CodingSessionRef;
    messageId: string;
    userId?: string;
  }) => {
    const sessionRow = await deps.prisma.codingSession.findUnique({
      where: { id: input.session.id },
    });
    const runId = sessionRow?.latestRunId ? String(sessionRow.latestRunId) : null;
    if (!runId) throw new Error("no active run to steer");
    await deps.prisma.steeringMessage.create({
      data: {
        messageId: input.messageId,
        botId: await botIdForRun(runId),
        userId: input.userId ?? (await userIdForRun(runId)),
        runId,
      },
    });
    return { runId, steered: true };
  };

  async function sessionRow(id: string): Promise<Record<string, unknown>> {
    const row = await deps.prisma.codingSession.findUnique({ where: { id } });
    if (!row) throw new Error(`Coding session "${id}" not found`);
    return row as unknown as Record<string, unknown>;
  }
  const spaceIdForSession = async (id: string) => String((await sessionRow(id)).spaceId);
  const threadIdForSession = async (id: string) => requiredThreadId(await sessionRow(id), id);
  const botIdForSession = async (id: string) => String((await sessionRow(id)).botId);

  async function runRow(runId: string): Promise<Record<string, unknown>> {
    const row = await deps.prisma.run.findFirst({ where: { id: runId } });
    if (!row) throw new Error(`Run "${runId}" not found`);
    return row as unknown as Record<string, unknown>;
  }
  const botIdForRun = async (runId: string) => String((await runRow(runId)).botId);
  const userIdForRun = async (runId: string) => String((await runRow(runId)).userId);

  return {
    id: "normal-pi",
    supportedOps: PI_SUPPORTED_OPS,
    describe: () => "normal-pi coding adapter on the existing run machinery",
    async dispatch<TResult>(
      session: CodingSessionRef,
      op: CodingSessionOp,
      payload: Record<string, unknown>,
    ): Promise<TResult> {
      return dispatchSessionOp(registry, session, op, async () => {
        switch (op) {
          case "prompt":
            return prompt({
              session,
              text: String(payload.text ?? ""),
              messageId: String(payload.messageId ?? ""),
              ...(payload.userId ? { userId: String(payload.userId) } : {}),
            }) as Promise<TResult>;
          case "steer":
            return steer({
              session,
              messageId: String(payload.messageId ?? ""),
              ...(payload.userId ? { userId: String(payload.userId) } : {}),
            }) as Promise<TResult>;
          case "stop":
            return stop({ session }) as Promise<TResult>;
          case "resume":
            return resume({ session }) as Promise<TResult>;
          case "inspect_changes":
            return deps.inspectChanges() as Promise<TResult>;
          case "approvals":
            return approvals({ session }) as Promise<TResult>;
          default:
            throw new Error(`Unhandled coding op ${String(op)}`);
        }
      });
    },
  };
}
