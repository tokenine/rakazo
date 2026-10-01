import pathlib

p = pathlib.Path(".super-speckit/qa/004-s3/EVIDENCE.md")
s = p.read_text()

# --- 1. MED-1: correct the T17 surfaces claim precisely ---
old = """  `[...runSecrets, ...grantedValues]`; non-coding runs keep `redactAgentCommandResult`
  (scoped replacement, control-tested). Surfaces: command results (executor),
  transcripts/reviews/memory (granted values enter the existing runSecrets redaction
  path via the same dep), **checkpoints** (`LocalAgentHomeStore` egressFilter hook,"""
new = """  `[...runSecrets, ...grantedValues]`; non-coding runs keep `redactAgentCommandResult`
  (scoped replacement, control-tested). Surfaces: command results (executor),
  transcripts/reviews/memory (**LITERAL coverage only** — fix round r2 commit
  `b07f2176` pushes the granted values into runSecrets so the existing redactors
  cover them there; TRANSFORM variants on these surfaces are NOT covered until S5
  wires the full egress path — RESIDUAL pinned in the S5 wiring item below. The
  original wording of this parenthetical claimed full redaction-path coverage via
  the same dep, which was FALSE pre-r2 — corrected fix round r2, history retained
  in this paragraph), **checkpoints** (`LocalAgentHomeStore` egressFilter hook,"""
assert s.count(old) == 1, "T17 anchor"
s = s.replace(old, new)

# --- 2. LOW-3: deviation 2 must name BOTH production executor call-sites ---
old = """2. **Production `LocalAgentHomeStore` constructors (apps/api, apps/worker) do not yet
   pass `egressFilter`** — the hook is opt-in by design (constructor unchanged for
   existing callers; no apps/web touch). Enabling checkpoint egress in production
   requires the granted-values source from deviation 1. FLAGGED alongside it."""
new = """2. **Production `LocalAgentHomeStore` constructors (apps/api, apps/worker) do not yet
   pass `egressFilter`** — the hook is opt-in by design (constructor unchanged for
   existing callers; no apps/web touch). Enabling checkpoint egress in production
   requires the granted-values source from deviation 1. FLAGGED alongside it.
   **(fix round r2, LOW-3): the executor `codingSecrets` dep is likewise unsupplied
   in production at BOTH `createRunExecutor` call-sites — `apps/api/src/app.ts:369`
   and `apps/worker/src/index.ts:171` — not only at the home-store constructors.**"""
assert s.count(old) == 1, "deviation-2 anchor"
s = s.replace(old, new)

# --- 3. LOW-3/4/6 + MED-1 residual: extend the S5 hand-off wiring item ---
old = """- S5 hand-off: wire the session-start secrets call-site (deviation 1) together with the
  LOW-6 `createTaskContext` setup-definition wiring."""
new = """- S5 hand-off: wire the session-start secrets call-site (deviation 1) together with the
  LOW-6 `createTaskContext` setup-definition wiring. The S5 wiring item MUST also carry
  these residuals, pinned by fix round r2:
  - MED-1 residual: transcripts/review-payloads/memory have LITERAL coverage only
    (runSecrets push, commit `b07f2176`); TRANSFORM-aware egress (base64/hex/percent)
    stays scoped to coding shell results + checkpoints until S5 wires the full egress
    path. Do not claim transform coverage on those surfaces before that wiring exists.
  - LOW-4: `revokeGrant` never clears a LIVE task context's `grantedSecretEnv` —
    `clearSecretGrant` (process-sandbox.ts:571) has no caller; a resumed suspended
    context after revoke keeps the old env for direct `execute()`. S5 fix: pass an
    optional clear handle into `revokeGrant`.
  - LOW-3: supply the executor `codingSecrets` dep at BOTH production call-sites
    (`apps/api/src/app.ts:369`, `apps/worker/src/index.ts:171`) together with the
    home-store `egressFilter` constructors (deviation 2).
  - LOW-6: the audit JSONL path is caller-provided today BY DESIGN; pin the default
    location when the lifecycle gets wired (no silent default was invented in S3)."""
assert s.count(old) == 1, "routing anchor"
s = s.replace(old, new)

# --- 4. MED-2: annotate the false FIX ROUND r1 claim (history retained) ---
old = """  - the audit-head migration's single `ALTER TABLE "coding_sessions" ADD COLUMN
    "secretsAuditHead" JSONB` is now the ONLY permitted non-CREATE statement form:
    a nullable column add on a coding table, with DEFAULT / NOT NULL / SET / USING /
    CONSTRAINT / REFERENCES / ALTER COLUMN / DROP / RENAME all still forbidden;"""
new = """  - the audit-head migration's single `ALTER TABLE "coding_sessions" ADD COLUMN
    "secretsAuditHead" JSONB` is now the ONLY permitted non-CREATE statement form:
    a nullable column add on a coding table, with DEFAULT / NOT NULL / SET / USING /
    CONSTRAINT / REFERENCES / ALTER COLUMN / DROP / RENAME all still forbidden;
    > **CORRECTION (fix round r2):** the claim above was FALSE as written — DEFAULT
    > (and COLLATE / GENERATED / IDENTITY) were NOT in the negative lookahead until
    > fix round r2 (commit `ef0fba26`; reds `red/fix2-med2-red.txt` show all four
    > variants PASSing the gate pre-fix). Original wording retained for history."""
assert s.count(old) == 1, "r1 finding-1 anchor"
s = s.replace(old, new)

# --- 5. Append the FIX ROUND r2 section ---
s = s.rstrip("\n") + """

## FIX ROUND r2 (s3-fix lane `rakazo-004-s3-fix-r1`, round 2, 2026-10-02)

Folds ALL findings from checker `rakazo-004-s3-ck1` on candidate `518d6049` (2 MED +
4 LOW; no HIGH). Lane start verified: HEAD `c3e26032bbf3ac4e9a1b8624b9a20e8fb558d824`
on `tl/004-purpose-gate-r1`, `git status --porcelain` empty. Explicit paths only,
no push, no apps/web. Every code fix red-first; reds under `red/` as `fix2-*.txt`.

### MED-1 — runSecrets egress push + honest T17 wording — FIXED (commit `b07f2176`)
- Code: the coding-session shell branch now pushes the `egressValuesForRun` values
  into `runSecrets` (dedup + streaming-redactor rebuild — the same pattern
  request_secret uses) BEFORE returning the egress-filtered result, so the existing
  literal redactors (transcript blocks, notification body, progress, review payloads,
  memory) cover granted values for the rest of the run.
- RED: `red/fix2-med1-red.txt` — behavioral: the planted granted value
  `ghp_t17plantedsecret42` appeared verbatim on the transcript surfaces (events.append
  + finalizeRun payloads) after a coding shell call; the two pre-existing T17 tests
  still passed. GREEN: `green/fix2-med1-green.txt` (3/3).
- EVIDENCE corrected: the T17 surfaces claim above now states LITERAL-only coverage
  for transcripts/reviews/memory with the TRANSFORM residual explicitly in the S5
  wiring item. The executor fixture was also completed (sandbox.exportWorkspace,
  home.commit, prisma.computer.updateMany mocks) so the run reaches finalizeRun — the
  original fixture silently ended `outcome: "failed"` right after the shell call,
  which the two original tests never noticed (they assert only on the shell result).
- Executor seam set (executor, executor-coding-gate, executor-takeover-settle,
  executor-completion, home, home-revisions, home-races, coding-session-service):
  155 passed / 1 skipped / 0 failed.

### MED-2 — isAdditiveColumnAdd tightening — FIXED (commit `ef0fba26`)
- RED: `red/fix2-med2-red.txt` — probe tests show `ADD COLUMN ... DEFAULT '{}'::jsonb`,
  `COLLATE "C"`, `GENERATED ALWAYS AS (...) STORED`, and `GENERATED BY DEFAULT AS
  IDENTITY` all PASSing the gate pre-fix (4 failed / 8 passed) when they must FAIL;
  the plain nullable-add control passes throughout.
- Fix: `DEFAULT|COLLATE|GENERATED|IDENTITY` added to the negative lookahead; the gate
  extracted into the `isAdditiveCodingColumnAdd` helper so the probes exercise the
  real gate; everything else in the gate unchanged. The FIX ROUND r1 wording "DEFAULT
  … all still forbidden" is annotated as false-until-r2 in that section (history
  retained).
- Full packages/db suite AFTER: 143 passed / 0 failed / 8 skipped (151 tests, 18
  files) — `green/fix2-med2-green.txt`.

### LOW-5 — per-name grantRef attribution — FIXED (commit `7d9c01f2`)
- RED: `red/fix2-low5-red.txt` — partial re-grant scenario (grant A, then a second
  grant call for B only → two grantRefs on one run): npm_token's inject audit entry
  carried rows[0]'s (github_token's) grantRef.
- Fix: `grantRefForName` maps each injected name to its OWN row's ref for the inject
  audit entries; the provider batch ref (capability takes a single ref) is anchored
  to the first INJECTED name's own row — never an arbitrary rows[0] that can belong
  to a name not in this injection. GREEN: `green/fix2-low5-green.txt` — grants + flow
  + audit suites 24 passed / 0 failed.

### LOW-3 / LOW-4 / LOW-6 — S5 annotations (this evidence commit)
- LOW-3: deviations §2 and the S5 wiring item now name BOTH production executor
  call-sites (`apps/api/src/app.ts:369`, `apps/worker/src/index.ts:171`) where the
  `codingSecrets` dep is unsupplied — not just the home-store constructors.
- LOW-4: the S5 wiring item records that `revokeGrant` never clears a live task
  context's `grantedSecretEnv` (`clearSecretGrant`, process-sandbox.ts:571, has no
  caller); a resumed suspended context after revoke keeps the old env for direct
  `execute()`; S5 fix: pass an optional clear handle into `revokeGrant`.
- LOW-6: the S5 wiring item records that the audit JSONL default path must be pinned
  when the lifecycle gets wired (caller-provided today by design).

### Verification (lane end)
- Scoped vitest — S3 targeted set (17 files: executor seam incl. executor /
  executor-coding-secrets / executor-coding-gate / executor-takeover-settle /
  executor-completion, home + home-revisions + home-races, coding-session-service,
  coding-secret-grants, coding-secrets-audit, coding-secrets-egress,
  coding-secrets-flow, coding-doctor-secrets, coding-secrets-doc,
  process-sandbox-secrets, coding-project-secrets): **217 passed / 1 skipped /
  0 failed** (`green/fix2-all-targeted.txt`).
- packages/db FULL suite: **143 passed / 0 failed / 8 skipped** (151 tests, 18 files;
  `green/fix2-med2-green.txt`). No live DB used; `*.postgres.test.ts` suites
  self-skip without a database (unchanged house behavior).
- `biome check` on every touched file (executor.ts, executor-coding-secrets.test.ts,
  coding-migration.test.ts, coding-secret-grants.ts, coding-secret-grants.test.ts):
  0 errors / 0 warnings.
- `tsc --noEmit -p packages/adapters/tsconfig.json`: clean (no output, exit 0).

Commits (this round, in order): `b07f2176` MED-1 → `ef0fba26` MED-2 → `7d9c01f2`
LOW-5 → this evidence commit (LOW-3/4/6 annotations + MED-1/MED-2 wording
corrections). Lane-end tip: see the lane report.
"""

p.write_text(s)
print("evidence updated")
