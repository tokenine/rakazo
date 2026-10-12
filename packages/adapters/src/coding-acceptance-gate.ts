/**
 * 004-code-mode T4 — acceptance-artifact gate (R1, V2 precondition).
 *
 * Before the agent's first edit, the coding session requires a recorded
 * acceptance artifact: the agreed outcome plus the verification commands.
 * Refusal is explicit (a reason string returned to the tool loop and counted
 * on the session row), never a silent pass. The executor consults this gate
 * at the same point it evaluates tool approvals (see executor.ts codingGate).
 *
 * Fix-round policy (checker HIGH-1) — DENY-BY-DEFAULT for coding sessions:
 * the first cut listed an "edit class" of tool names, but several of those
 * names do not exist in builtin-tools.ts while genuinely mutation-capable
 * builtin tools (js, client_js, computer_act, browser_act, attach_file,
 * add_mcp_server, schedule_create, the secret-request family, spawn/launch
 * tools, open_path/launch_app, ...) were ungated. The policy is now inverted:
 *
 * - CODING_READ_ONLY_TOOLS is an explicit, minimal allowlist of
 *   observation/list/read builtin tools (every name is verified against the
 *   real builtinAgentTools surface by test) that pass without acceptance;
 * - every other tool name — builtin, connector, or entirely unknown — is
 *   gated until acceptance is recorded for the session's run (existing
 *   acceptance semantics unchanged: record once, then everything passes);
 * - refusal stays explicit and is counted on the session row;
 * - the gate FAILS CLOSED: a coding_session run with NO gate installed still
 *   refuses every non-allowlisted tool (enforced in executor.ts next to the
 *   gate call, keyed on the run trigger). Absent gate + non-coding run keeps
 *   the legacy pass-through behavior.
 */

import type { PrismaClient } from "@rakazo/db";
import { z } from "zod";

/**
 * Real builtin tool names (see builtin-tools.ts) that only observe or read:
 * they never mutate the workspace, repo, threads, schedules, secrets, or any
 * other durable state, so they pass the gate without an acceptance artifact.
 * Everything else is denied by default for coding sessions until acceptance
 * is recorded. Unknown/phantom names are never on this list — deny-by-default
 * covers them.
 */
export const CODING_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "browser_snapshot",
  "computer_observe",
  "list_files",
  "list_secrets",
  "read_file",
  "schedule_list",
  "scratchpad_list",
  "skill_read",
  "web_fetch",
  "web_search",
]);

export const ACCEPTANCE_REFUSAL_HINT =
  "Record the agreed outcome and verification commands for this session before editing.";

/**
 * The explicit refusal for a gated tool. Shared by the gate service and the
 * executor's fail-closed path (coding_session run without an installed gate)
 * so the model always sees the same actionable message.
 */
export function acceptanceRefusalReason(toolName: string): string {
  return (
    `Refused: "${toolName}" can mutate state and no acceptance artifact is recorded for this ` +
    `coding session yet. Agree the outcome and verification commands with the user first. ` +
    `${ACCEPTANCE_REFUSAL_HINT}`
  );
}

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
    // Read-only observation tools never require the gate.
    if (CODING_READ_ONLY_TOOLS.has(input.toolName)) return { allowed: true };
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
        `Refused: no acceptance artifact is recorded for coding session ${session.id}; ` +
        `"${input.toolName}" stays gated until acceptance is recorded. ` +
        `${ACCEPTANCE_REFUSAL_HINT}`,
    };
  };

  const get: AcceptanceGateService["get"] = async (sessionId) => {
    const session = await deps.prisma.codingSession.findUnique({ where: { id: sessionId } });
    if (!session) return null;
    return parseAcceptanceRecord((session as unknown as { acceptance?: unknown }).acceptance);
  };

  return { check, record, get };
}
