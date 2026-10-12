"""One-shot S3 patch (T20): carve-out annotation at the TOP of docs/bot-secrets.md.

Annotation only — the rest of the doc is untouched.
"""
from pathlib import Path

path = Path("docs/bot-secrets.md")
src = path.read_text()
assert "004-code-mode" not in src, "already annotated"

annotation = """<!-- 004-code-mode carve-out (T20, Q10 Option B) — ANNOTATION AT TOP, doc not rewritten. -->
> **Scope note for 004-code-mode task runtimes ONLY:** the blanket refusal below —
> "injecting credentials into arbitrary AI-controlled shell commands, files or
> environment variables … is not exposed" — is **superseded for 004-code-mode task
> runtimes** by the audited project-secrets subsystem: declared secret NAMES are
> granted per (workspace, taskRun), values are injected at process spawn/bootstrap
> env only through a capability-gated, audited channel, hashed-chain audited
> (`audit verify`), TTL-bounded, revocable, and swept by a deny-list egress filter
> (literal + base64/hex/URL). See
> `.super-speckit/design/004-code-mode/decision.json` (Q10, Option B) and
> `specs/004-code-mode/verification-matrix.md` (V8–V11). The **blanket refusal
> stands everywhere else** — bots outside 004-code-mode task runtimes still have
> no shell/file/env credential injection.

"""

path.write_text(annotation + src)
print("annotated")
