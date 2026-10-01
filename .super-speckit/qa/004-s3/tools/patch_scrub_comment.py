"""One-shot S3 patch: refresh the scrub module comment for the S3 design."""
from pathlib import Path

path = Path("packages/adapters/src/process-env-scrub.ts")
src = path.read_text()
old = """ * At spawn, a task's environment contains ONLY an explicit allowlist of the
 * parent's variables plus the task config's declared vars (plus, in S3, the
 * Q10-granted secrets). Nothing else from the parent process leaks through:
 * the scrub is a positive-selection allowlist, not a denylist."""
new = """ * At spawn, a task's environment contains ONLY an explicit allowlist of the
 * parent's variables plus the task config's declared vars (plus the screened
 * per-command env). Q10-granted secrets (S3/T16) do NOT ride this function's
 * declared-vars argument: they enter through a separate audited grant
 * channel (process-sandbox.ts applySecretGrant) composed after the scrub, so
 * the per-command env can never re-inject what the grant path injects
 * (LOW-7). Nothing else from the parent process leaks through: the scrub is
 * a positive-selection allowlist, not a denylist."""
assert old in src
path.write_text(src.replace(old, new, 1))
print("comment updated")
