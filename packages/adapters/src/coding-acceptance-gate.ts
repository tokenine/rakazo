/**
 * 004-code-mode T4 — acceptance-artifact gate (R1, V2 precondition).
 *
 * Before the agent's first edit, the coding session requires a recorded
 * acceptance artifact: the agreed outcome plus the verification commands.
 * Refusal is explicit (a reason string returned to the tool loop and counted
 * on the session row), never a silent pass. The executor consults this gate
 * at the same point it evaluates tool approvals (see executor.ts codingGate).
 */

import type { PrismaClient } from "@rakazo/db";
import { z } from "zod";

/** Builtin tools that mutate the workspace/repo and therefore require the gate. */
export const EDIT_CLASS_CODING_TOOLS: ReadonlySet<string> = new Set([
  "shell",
  "write_file",
  "edit_file",
  "multi_edit",
  "apply_patch",
  "move_file",
  "delete_file",
]);

export const ACCEPTANCE_REFUSAL_HINT =
  "Record the agreed outcome and verification commands for this session before editing.";

const acceptanceRecordSchema = z.object({
  outcome: z.string().trim().min(1),
  verificationCommands: z.array(z.string().trim().min(1)).min(1),
  recordedAt: z.string().min(1),
});

export type AcceptanceRecord = z.infer<typeof acceptanceRecordSchema>;

export function parseAcceptanceRecord(value: unknown): AcceptanceRecord | null {
  const parsed = acceptanceRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type GateVerdict = { allowed: true } | { allowed: false; reason: string };

export interface CodingAcceptanceGate {
  check(input: {
    runId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<GateVerdict>;
}

export interface AcceptanceGateService extends CodingAcceptanceGate {
  record(input: {
    sessionId: string;
    outcome: string;
    verificationCommands: string[];
  }): Promise<AcceptanceRecord>;
  get(sessionId: string): Promise<AcceptanceRecord | null>;
}

export function createAcceptanceGateService(deps: {
  prisma: PrismaClient;
  now?: () => Date;
}): AcceptanceGateService {
  const now = deps.now ?? (() => new Date());

  const record: AcceptanceGateService["record"] = async (input) => {
    const candidate = {
      outcome: input.outcome,
      verificationCommands: input.verificationCommands,
      recordedAt: now().toISOString(),
    };
    const parsed = acceptanceRecordSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        "Invalid acceptance record: an outcome and at least one verification command are required.",
      );
    }
    await deps.prisma.codingSession.update({
      where: { id: input.sessionId },
      data: { acceptance: parsed.data },
    });
    return parsed.data;
  };

  const check: CodingAcceptanceGate["check"] = async (input) => {
    if (!EDIT_CLASS_CODING_TOOLS.has(input.toolName)) return { allowed: true };
    const session = await deps.prisma.codingSession.findFirst({
      where: { latestRunId: input.runId },
    });
    // Only coding sessions are gated; every other run passes through.
    if (!session) return { allowed: true };
    const existing = parseAcceptanceRecord(
      (session as unknown as { acceptance?: unknown }).acceptance,
    );
    if (existing) return { allowed: true };
    await deps.prisma.codingSession.update({
      where: { id: session.id },
      data: { refusals: { increment: 1 } },
    });
    return {
      allowed: false,
      reason:
        `Refused: no acceptance artifact is recorded for coding session ${session.id}. ` +
        `Agree the outcome and verification commands with the user first. ${ACCEPTANCE_REFUSAL_HINT}`,
    };
  };

  const get: AcceptanceGateService["get"] = async (sessionId) => {
    const session = await deps.prisma.codingSession.findUnique({ where: { id: sessionId } });
    if (!session) return null;
    return parseAcceptanceRecord((session as unknown as { acceptance?: unknown }).acceptance);
  };

  return { check, record, get };
}
