/**
 * 004-code-mode S4 — T22/T23 continuity + crash reconciliation.
 *
 * These functions surface the reconnect and crash-reconciliation data
 * for the coding-session adapter. They are the seam between the
 * existing run machinery (executor.ts lease/fence, requeue path) and
 * the session-level recovery surface that V6 requires.
 */

import type { SessionServiceDeps } from "./coding-session-service.js";
import { CodingSessionNotFoundError } from "./coding-session-service.js";

const IS_TERMINAL_OUTCOME: Record<string, true> = {
  completed: true,
  failed: true,
  cancelled: true,
};
const SUCCESS_OUTCOME = "completed";

// ─── T22: Reconnect resume data ───────────────────────────────────────────────

export interface ResumeData {
  runId: string | null;
  /** Whether the run was actively running when we looked. */
  wasActive: boolean;
}

/**
 * T22 (V6): Returns the latest run id and activity state for a coding session.
 * The reconnect path uses this to determine what to resume — it enqueues the
 * runContinue job for the returned runId. The fence in continueRun prevents
 * a second worker from also claiming the same run.
 */
export async function getCodingSessionResumeData(
  deps: SessionServiceDeps,
  input: { sessionId: string },
): Promise<ResumeData> {
  const session = await deps.prisma.codingSession.findUnique({
    where: { id: input.sessionId },
  });
  if (!session) throw new CodingSessionNotFoundError(input.sessionId);

  const runId = session.latestRunId ? String(session.latestRunId) : null;
  if (!runId) return { runId: null, wasActive: false };

  const run = await deps.prisma.run.findFirst({
    where: { id: runId },
    select: { status: true },
  });

  const wasActive = run != null && run.status !== null && !IS_TERMINAL_OUTCOME[String(run.status)];
  return { runId, wasActive };
}

// ─── T22: Pending approvals ───────────────────────────────────────────────────

export type PendingApproval = {
  id: string;
  kind: string;
  status: string;
  request: unknown;
};

/**
 * T22 (V6): Returns pending approval effects for the session's latest run.
 * Used after reconnect so the client can see what approvals are waiting.
 */
export async function getCodingSessionApprovals(
  deps: SessionServiceDeps,
  input: { sessionId: string },
): Promise<PendingApproval[]> {
  const session = await deps.prisma.codingSession.findUnique({
    where: { id: input.sessionId },
  });
  if (!session) throw new CodingSessionNotFoundError(input.sessionId);

  const runId = session.latestRunId ? String(session.latestRunId) : null;
  if (!runId) return [];

  const pending = await deps.prisma.externalEffect.findMany({
    where: { runId, status: "pending" },
    select: { id: true, kind: true, status: true, request: true },
  });

  return pending.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    status: String(row.status),
    request: row.request,
  }));
}

// ─── T23: Crash reconciliation ────────────────────────────────────────────────

export interface CrashReconciliationData {
  sessionId: string;
  runId: string | null;
  outcome: string;
  /** False for any non-completed outcome — stopped/cancelled/failed are not success. */
  isSuccess: boolean;
  lastAction: string | null;
}

/**
 * T23 (V6): Returns crash-reconciliation data for a coding session.
 * Surfaces the last action and outcome BEFORE any retry so the client
 * can inspect the workspace dirty-set and decide how to proceed.
 *
 * "stopped ≠ success" — a stopped/cancelled/failed run is never isSuccess.
 * Only "completed" is a successful outcome.
 */
export async function getCrashReconciliationData(
  deps: SessionServiceDeps,
  input: { sessionId: string },
): Promise<CrashReconciliationData> {
  const session = await deps.prisma.codingSession.findUnique({
    where: { id: input.sessionId },
  });
  if (!session) throw new CodingSessionNotFoundError(input.sessionId);

  const runId = session.latestRunId ? String(session.latestRunId) : null;
  let outcome = "";
  let isSuccess = false;

  if (runId) {
    const run = await deps.prisma.run.findFirst({
      where: { id: runId },
      select: { status: true, completedAt: true },
    });
    outcome = run?.status ? String(run.status) : "";
    isSuccess = outcome === SUCCESS_OUTCOME;
  }

  // Last steering/tool action — most recent steering message for this run
  let lastAction: string | null = null;
  if (runId) {
    const lastSteering = await deps.prisma.steeringMessage.findFirst({
      where: { runId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (lastSteering) {
      lastAction = `steering:${String(lastSteering.id)}`;
    }
  }

  return {
    sessionId: input.sessionId,
    runId,
    outcome,
    isSuccess,
    lastAction,
  };
}
