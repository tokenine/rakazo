/**
 * 004-code-mode T8/T9 — the process-driver env scrub primitive (D-Q9).
 *
 * At spawn, a task's environment contains ONLY an explicit allowlist of the
 * parent's variables plus the task config's declared vars (plus the screened
 * per-command env). Q10-granted secrets (S3/T16) do NOT ride this function's
 * declared-vars argument: they enter through a separate audited grant
 * channel (process-sandbox.ts applySecretGrant) composed after the scrub, so
 * the per-command env can never re-inject what the grant path injects
 * (LOW-7). Nothing else from the parent process leaks through: the scrub is
 * a positive-selection allowlist, not a denylist.
 */

/** Base keys a task runtime needs to function; everything else is scrubbed. */
export const PROCESS_ENV_SCRUB_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
] as const;

/**
 * Scrub `source` down to the allowlist plus the task config's declared vars.
 * Declared vars win over allowlisted keys (the task config is the explicit
 * override channel); undeclared parent variables never pass.
 */
export function scrubProcessEnv(
  source: Record<string, string | undefined>,
  declared: Record<string, string> = {},
): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const key of PROCESS_ENV_SCRUB_ALLOWLIST) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) scrubbed[key] = value;
  }
  for (const [key, value] of Object.entries(declared)) {
    if (typeof value === "string") scrubbed[key] = value;
  }
  return scrubbed;
}
