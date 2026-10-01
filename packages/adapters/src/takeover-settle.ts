/**
 * 004-code-mode T12 — takeover settle (G1/Q4, V4).
 *
 * Scope proven by the grill: the takeover gap is four handlers wide — shell,
 * write_file, schedule_create, add_mcp_server — not just the desktop tools.
 * While the user holds the screen (run status waiting_takeover, no release
 * checkpoint), those handlers use the same heldForTakeover guard pattern as
 * the desktop tools and settle or block: an explicit signal (tool-named held
 * message), a bounded wait (no unbounded holding), and a recorded exit (the
 * refusal is persisted in the tool result via the executor's finish()).
 *
 * Pre-resume recheck: before a held run resumes, its workspace is compared
 * against the takeover baseline (the revision checkpointed when the run
 * paused). Manual edits made during the hold are reported as PROTECTED —
 * neither the user's edits nor the bot's work is silently lost, and nothing
 * is implied rolled back.
 */

import type { AgentHomeStore } from "@rakazo/adapter-kit";

/** Bounded wait for in-flight guarded work after a takeover signal. */
export const TAKEOVER_SETTLE_BOUND_MS = 10_000;

export const TAKEOVER_HELD_TOOLS = [
  "shell",
  "write_file",
  "schedule_create",
  "add_mcp_server",
] as const;

export type TakeoverHeldTool = (typeof TAKEOVER_HELD_TOOLS)[number];

/** Shown when desktop tools are gated because the user still holds the screen. */
export const DESKTOP_HELD_FOR_TAKEOVER_MESSAGE =
  "The user has the screen and desktop control is theirs until the takeover ends. Desktop tools are paused, and state-changing tools (shell, write_file, schedule_create, add_mcp_server) are held while the takeover is active.";

/** Explicit, tool-named held message for the guarded handlers (recorded exit). */
export function takeoverHeldToolMessage(tool: string): string {
  return (
    `Not run: ${tool} is held while the user has the screen (takeover in progress). ` +
    "The call was recorded as blocked. Wait for the takeover to end before retrying; " +
    "do not work around the hold."
  );
}

export type TakeoverSettlementOutcome = "completed" | "settled-timeout";
export type TakeoverRecordedExit = "ok" | "unconfirmed";

export interface TakeoverSettlement<T> {
  outcome: TakeoverSettlementOutcome;
  recordedExit: TakeoverRecordedExit;
  waitedMs: number;
  value?: T;
}

/**
 * Settles in-flight work against a takeover signal: SIGNAL (the takeover
 * abort reaches the operation), BOUNDED WAIT (never longer than boundMs after
 * the signal or, absent a signal, the bound from invocation), RECORDED EXIT
 * (completed values are kept; timed-out work is recorded unconfirmed so the
 * caller never assumes success or silence).
 */
export async function settleForTakeover<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: {
    takeover: AbortSignal;
    boundMs?: number;
  },
): Promise<TakeoverSettlement<T>> {
  const boundMs = options.boundMs ?? TAKEOVER_SETTLE_BOUND_MS;
  const controller = new AbortController();
  const onTakeover = () => controller.abort();
  options.takeover.addEventListener("abort", onTakeover, { once: true });
  const startedAt = Date.now();
  let takeoverFiredAt: number | undefined;
  const onTakeoverStamp = () => {
    takeoverFiredAt = Date.now();
  };
  options.takeover.addEventListener("abort", onTakeoverStamp, { once: true });

  const operationPromise = operation(controller.signal).then(
    (value): TakeoverSettlement<T> => ({
      outcome: "completed",
      recordedExit: "ok",
      waitedMs: Date.now() - (takeoverFiredAt ?? startedAt),
      value,
    }),
  );
  const boundPromise = new Promise<TakeoverSettlement<T>>((resolve) => {
    const timer = setTimeout(() => {
      controller.abort();
      resolve({
        outcome: "settled-timeout",
        recordedExit: "unconfirmed",
        waitedMs: Date.now() - (takeoverFiredAt ?? startedAt),
      });
    }, boundMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operationPromise, boundPromise]);
  } finally {
    options.takeover.removeEventListener("abort", onTakeover);
    options.takeover.removeEventListener("abort", onTakeoverStamp);
  }
}

export interface TakeoverWorkspaceRecheck {
  diverged: boolean;
  changedPaths: string[];
  note: string;
}

/**
 * Pre-resume recheck (V4): compares the CURRENT committed workspace state
 * against the takeover baseline revision. Divergence means work happened
 * while the user held the screen; the note instructs the model to protect it.
 * A missing baseline returns undefined (nothing to compare); an unusable one
 * throws (the caller skips the recheck rather than guessing).
 */
export async function recheckWorkspaceAgainstTakeoverBaseline(
  home: AgentHomeStore,
  computer: { homeKey: string; homeRevision?: string | null },
): Promise<TakeoverWorkspaceRecheck | undefined> {
  if (!computer.homeRevision) return undefined;
  const dirty = await home.changesSince(computer.homeKey, computer.homeRevision);
  const changedPaths = [...dirty.changed, ...dirty.added, ...dirty.removed].sort();
  if (changedPaths.length === 0) {
    return { diverged: false, changedPaths: [], note: "" };
  }
  const preview = changedPaths.slice(0, 8).join(", ");
  const suffix = changedPaths.length > 8 ? `, +${changedPaths.length - 8} more` : "";
  return {
    diverged: true,
    changedPaths,
    note:
      `Workspace recheck: ${changedPaths.length} path(s) changed since the takeover baseline ` +
      `(${preview}${suffix}). Manual work done while you were held is present in the workspace ` +
      "and is PROTECTED — do not overwrite, revert, or re-checkpoint over it. External side " +
      "effects that happened during the takeover are not implied rolled back.",
  };
}
