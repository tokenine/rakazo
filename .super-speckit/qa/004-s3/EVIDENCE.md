# 004-code-mode — Slice 3 (Secrets subsystem, Q10) EVIDENCE

Lane: **`rakazo-004-s3-maker-r1`** (maker; super-speckit maker ≠ checker)
Base SHA: **`1c0bb3479c005e8f38b450ef344b51126eabafe9`** (verified: `git rev-parse HEAD` at lane start; `git status --porcelain` empty)
Branch: `tl/004-purpose-gate-r1` — NO push (per lane rules)
Final HEAD SHA: the tip of `tl/004-purpose-gate-r1` at lane end (reported in the lane
message; the last commits are evidence-only). Implementation tip: **`ec81b0a5`**;
evidence commits follow it (see commit list below). `apps/web` untouched —
`git diff 1c0bb347..HEAD --stat -- apps/web` is empty.

Scope executed: `specs/004-code-mode/tasks.md` Slice 3, T14–T21, against `plan.md` S3 + Risks
(threat model = boundary), `verification-matrix.md` rows V8/V9/V10/V11, and
`.super-speckit/design/004-code-mode/decision.json` Q10 Option B (five constraints:
per-task least-privilege scoping; hash-chained JSONL audit + audit verify; deny-list egress
filter; injection at process spawn/bootstrap env only; TTL + revoke). S2 TRACKING LOW-7
folded as the binding constraint. S2's V12 doctor disclosure stays truthful (doctor
delegates to the same predicate the runtime uses; all 14 doctor-suite tests green).

## Ratified v1 constants (declared, NOT changed)

1. **Lease TTL default = 10 minutes** — `SECRETS_GRANT_TTL_MS = DEFAULT_LEASE_TTL_MS`
   (coding-session-service.ts, 10 * 60_000); `SECRETS_GRANT_TTL_SECONDS = 600`.
2. **Credential name `github_token`** — used as the standing example/granted name in the
   subsystem tests; the name grammar is `BotSecretName` (`^[a-z][a-z0-9_]{0,63}$`,
   no wildcards v1).
3. **nproc default 4096** — `DEFAULT_PROCESS_TASK_LIMITS.maxProcesses` untouched.
4. **Port probe bind→release contract** — `allocatePort` untouched.

## Products per task

### Binding constraint (Chief directive; S2 TRACKING LOW-7) — `c45006a8`
- **Regression test name:** `process-sandbox-secrets.test.ts` → describe
  `"binding constraint: request.env can never re-inject grant-gated secrets (LOW-7)"`,
  tests: *"refuses a command whose request.env carries a declared secret name — the value
  never reaches the child"*, *"refuses request.env value collisions…"*, *"a
  declared-but-not-yet-granted name is already gated…"*, *"no error path silently
  downgrades…"*, plus the non-gated pass-through control. 10 tests total in the file.
- **Structural fix:** `process-sandbox.ts execute()` now (1) screens request.env with
  `screenCommandEnv` BEFORE anything spawns — a grant-gated NAME (case-insensitive) or a
  VALUE carrying a granted secret refuses the whole command (exit 1, explicit stderr,
  fail closed, no silent strip, no downgrade); (2) composes child env as
  `{identity…, ...scrubProcessEnv(process.env, {...task.env, ...screen.env}),
  ...task.grantedSecretEnv}` — granted secrets enter OUTSIDE scrubProcessEnv's
  declared-vars argument through a separate channel written ONLY by
  `applySecretGrant(taskId, env, {grantRef, auditHead})`, which refuses undeclared names
  and refuses to act without the grant + audit reference. There is no other write path
  to `grantedSecretEnv`.
- **RED evidence (behavioral, pre-fix leak):** `red/binding-low7-t16.txt` —
  `AssertionError: expected 'LEAKED:attacker-controlled-value' not to contain
  'attacker-controlled-value'` (today's code passed request.env wholesale).

### T14 — Project secrets store (V9) — `477241bf`
- Schema verified first: `BotSecret` (packages/db/prisma/schema.prisma) is
  (user, space, bot, name)-keyed and HTTP-destination-shaped — it cannot hold project
  secrets; **reuse** = the SAME `EncryptedSecretStore` (AES-256-GCM, record-bound AAD,
  v2 seal format) that bot_secrets uses.
- `coding-project-secrets.ts` + `coding_project_secrets` table (additive migration
  `20261002030000_coding_project_secrets`, protected path — flagged for independent
  review before merge). Rows carry ciphertext + rotation metadata only.
- Tests: 9 (`coding-project-secrets.test.ts`): encrypted-at-rest, round-trip,
  per-workspace scoping, wildcard/uppercase/dash name refusal, rotation semantics,
  100-per-workspace limit, metadata-only listing, value-free secretRef, removal.
- RED: module-not-found (`red/t14-store.txt`) — module genuinely did not exist.

### T15 — Grants (V9) — `7f66d3c0`
- `coding-secret-grants.ts`: deny-by-default gate family of T4 — declared NAMES only,
  every name must exist in the store before any grant row is written (single explicit
  refusal listing the missing), wildcards/malformed names refused at declaration,
  injection resolves granted names only, TTL per (workspace, taskRun) =
  grantedAt + 600s, grants scoped to the pair (no inheritance across runs).
- Durable `coding_secret_grants` table (additive migration
  `20261002032000_coding_secret_grants`, protected path — flagged).

### T16 — Bootstrap injection at process spawn/bootstrap env only (V9) — `c45006a8`
- Injection happens ONLY at spawn env composition in `execute()` via the audited grant
  channel (see binding constraint above); the in-test grep gate proves the injection
  path writes values to NO tree (workspace, data, provider root scanned after a granted
  run: zero hits). No file-based injection channel exists.

### T17 — Egress deny-list filter (V8) — `e3d947d5`
- `coding-secrets-egress.ts`: `secretEgressVariants` (literal, base64, base64url,
  hex lower/upper, percent), `SecretEgressFilter` (text/command-result/UTF-8-file
  ≤1MiB), `sweepSurfacesForSecretEgress`.
- **Replaces literal-only redaction for coding sessions:** executor.ts shell handler —
  when `run.trigger === "coding_session"` and `deps.codingSecrets.egressValuesForRun`
  yields values, results are redacted by `SecretEgressFilter` over
  `[...runSecrets, ...grantedValues]`; non-coding runs keep `redactAgentCommandResult`
  (scoped replacement, control-tested). Surfaces: command results (executor),
  transcripts/reviews/memory (**LITERAL coverage only** — fix round r2 commit
  `b07f2176` pushes the granted values into runSecrets so the existing redactors
  cover them there; TRANSFORM variants on these surfaces are NOT covered until S5
  wires the full egress path — RESIDUAL pinned in the S5 wiring item below. The
  original wording of this parenthetical claimed full redaction-path coverage via
  the same dep, which was FALSE pre-r2 — corrected fix round r2, history retained
  in this paragraph), **checkpoints** (`LocalAgentHomeStore` egressFilter hook,
  filtering BEFORE manifest hashing so revision hashes describe stored content),
  handoff summaries + QA evidence (V8 sweep surfaces in tests).
- Tests: 11 (`coding-secrets-egress.test.ts` 9 incl. the V8 **control** proving the
  sweep detects the planted value in an unfiltered surface + unfiltered checkpoint;
  `executor-coding-secrets.test.ts` 2 incl. the non-coding legacy-behavior control).
- RED: behavioral — `red/t17-egress.txt`: coding-session shell result leaked
  `literal:ghp_t17plantedsecret42 b64:… hex:…` under literal-only redaction;
  module-not-found for the egress module itself.
- 112 S1/S2 seam regression tests green in the same commit run (executor, home,
  coding-session suites).

### T18 — Audit chain (V10) — `ef8acafb`
- `coding-secrets-audit.ts`: append-only JSONL
  `{seq, ts, actor, botId, workspaceId, taskRunId, secretName, secretRef, mechanism,
  ttl, grantRef, prevHash, hash}`, `hash = sha256(prev_hash + canonical entry)` with
  `SECRETS_AUDIT_GENESIS_HASH`; `verifySecretsAuditChain` detects tampered fields,
  deleted/reordered entries, seq breaks, corrupted lines, and — via the head
  checkpointed to the run record (`CodingSession.secretsAuditHead`, additive column +
  migration `20261002031000_coding_session_secrets_audit_head`, protected path —
  flagged) — wholesale log replacement. Entries are value-free (name grammar enforced
  on append). `audit verify` output appears in this evidence set via
  `green/v8-v9-v10-v11-flow.txt` (chain verifies against the run-record head; sequence
  `grant → inject → revoke-force`).
- Tests: 8 (`coding-secrets-audit.test.ts`) with an INDEPENDENT hash oracle (test
  computes expected sha256 itself). RED: module-not-found (`red/t18-audit.txt`).

### T19 — Revocation + rotation (V11) — `7f66d3c0` (+ `ec81b0a5` checkpoint-on-event)
- TTL expiry enforced at NEXT start (`resolveGrantedSecrets` refuses `expired`, audited
  once per grant); revoke without `--force` enforced next start with the documented
  message; `--force` calls the task stop handle NOW (refuses explicitly without one —
  never pretends to stop); rotation (re-set) marks grants **stale** → refused at next
  start until an explicit re-grant (audited `rotate`/`stale`).
- Provider companion: `clearSecretGrant` clears injected values for subsequent spawns;
  live-task force-stop rides the existing `ProcessSandboxProvider.suspend`
  (exercised end-to-end in the flow test: `task.running === false` after `--force`).

### T20 — docs/bot-secrets.md carve-out annotation (V9 doc row) — `aff422d4`
- ANNOTATION at the very top only (HTML comment + blockquote scope note): superseded
  for 004-code-mode task runtimes ONLY, pointer to
  `.super-speckit/design/004-code-mode/decision.json` (Q10, Option B) and V8–V11;
  blanket refusal stands everywhere else. Doc NOT rewritten (original boundary text
  asserted still present). Tests: 4 (`coding-secrets-doc.test.ts`). RED:
  `red/t20-doc.txt` (3/4 failing pre-annotation).

### T21 — Fail-closed guard + both-direction disclosure (V11) — `7f66d3c0` + `ec81b0a5`
- `secretsRuntimeSupport(driverKind)` is the SINGLE ON/OFF predicate: enabled only for
  the spawn-owning `process` driver. `SecretsDisabledError` (explicit disclosure, never
  silent) fires before the store is even touched (test passes `store: undefined` to
  prove ordering). `SecretInjectionUnsupportedError` fails closed when a provider lacks
  the `applySecretGrant` capability.
- Doctor delegation (`ec81b0a5`): `codeModeSecretsState` now returns exactly
  `secretsRuntimeSupport(...)` mapped to `{state, reason}` — the doctor and the runtime
  gate cannot drift; the **confidentiality-bounded-by-threat-model disclosure** (same-UID
  note, D-Q10 §5) rides the doctor line in BOTH directions and every grant result.
  **V12 stays green** (all 14 doctor-suite tests pass; state+reason remain
  unconditional, ON truthfully reflects the real S3 subsystem under the process driver).
- Tests: 3 (`coding-doctor-secrets.test.ts`), 14 in `coding-secret-grants.test.ts`.
  RED: behavioral — `red/t21-doctor.txt` (reason strings pre-delegation lacked the
  shared predicate + disclosure).

### End-to-end flow (V8/V9/V10/V11) — `ec81b0a5`
- `coding-secrets-flow.test.ts` (1 test, big): RUNTIME-GENERATED canary
  (`s3canary-<32 hex>`, exists in no file before the run) flows
  store → grant → audited spawn injection → child sees value → request.env attack
  refused → in-test tree scan (V9) → revoke `--force` stops the task now →
  `verifySecretsAuditChain` against the run-record head (sequence
  grant/inject/revoke-force; log itself value-free) → artifact-surface sweep clean
  WITH the control proving the sweep detects the unfiltered canary.

## V-row verification summary

- **V8** (sweep, green only with a planted secret): planted values in
  `coding-secrets-egress.test.ts` (static unique plant + V8 control tests) and
  `coding-secrets-flow.test.ts` (runtime canary + control). Sweep covers prompt,
  transcript, command result, checkpoint revision, handoff summary, QA evidence
  surfaces. Evidence: `green/t17-egress.txt`, `green/v8-v9-v10-v11-flow.txt`.
- **V9** (scoping + injection boundary + grep gate + doc): granted-names-only,
  no wildcards, spawn-env-only injection (no-tree write test), runtime-canary grep gate
  GREEN (`green/v9-grep-gate.txt`; gate script
  `.super-speckit/qa/004-s3/tools/v9-grep-gate.sh` with a sensitivity CONTROL — the
  intentional unit-test plant is detected exactly where it is planted; workspace
  storage dir `data/code-mode-tasks` does not exist on this box — flows used temp
  fixtures, nothing persisted), carve-out annotation checked by test.
- **V10** (tamper-evident audit + `audit verify` + head matches run record):
  `green/t18-audit.txt` (tamper/splice/seq/parse/head-mismatch detections),
  `green/v8-v9-v10-v11-flow.txt` (chain verifies against the checkpointed run-record
  head in the live flow).
- **V11** (revocation + fail-closed honesty): `green/t15-t19-t21-grants.txt`
  (TTL next-start, revoke next-start vs `--force` stop-now, rotation staleness,
  fail-closed, disclosure), `green/t21-doctor.txt` (both-direction disclosure at the
  doctor gate; V12 intact), `green/binding-low7-t16.txt`.
- **Checkpoint "validate + status strict":** run at lane end — see below.

## Test counts (new tests, all red-first)

| File | New tests | Covers |
|---|---|---|
| coding-project-secrets.test.ts | 9 | T14 |
| coding-secrets-audit.test.ts | 8 | T18 |
| coding-secret-grants.test.ts | 14 | T15/T19/T21 |
| process-sandbox-secrets.test.ts | 10 | binding LOW-7 + T16 |
| coding-secrets-egress.test.ts | 9 | T17 + checkpoints |
| executor-coding-secrets.test.ts | 2 | T17 executor (scoped) |
| coding-secrets-doc.test.ts | 4 | T20 |
| coding-doctor-secrets.test.ts | 3 | T21 doctor |
| coding-secrets-flow.test.ts | 1 | V8–V11 flow |
| **Total new** | **60** | |

Pass/skip: 60/60 new tests pass; 0 new skips. Final targeted run (16 files, includes
the S1/S2 seam suites executor / executor-coding-gate / executor-takeover-settle /
home / home-revisions / coding-session-service / process-sandbox / doctor):
**137 passed, 0 failed, 0 skipped** (`green/all-s3-targeted.txt`). No live DB used;
`*.postgres.test.ts` suites untouched (self-skip without a database, per house rules).

## Red/green evidence files

- red/: `t14-store.txt`, `t18-audit.txt`, `t15-t19-t21-grants.txt`,
  `binding-low7-t16.txt` (behavioral leak proof), `t17-egress.txt` (behavioral leak
  proof), `t20-doc.txt`, `t21-doctor.txt`
- green/: `t14-store.txt`, `t18-audit.txt`, `t15-t19-t21-grants.txt`,
  `binding-low7-t16.txt`, `t17-egress.txt`, `t20-doc.txt`, `t21-doctor.txt`,
  `v8-v9-v10-v11-flow.txt`, `v9-grep-gate.txt`, `all-s3-targeted.txt`
- Weakest-form (module-not-found) reds appear ONLY for T14 and T18, where the module
  genuinely did not exist; every other red is behavioral against pre-fix code.

## Scoped biome + tsc

- `biome check` on every touched file after implementation: **0 errors / 0 warnings**
  (auto-fix runs applied formatting only; final states verified clean).

> **CORRECTION (fix round r1, lane `rakazo-004-s3-fix-r1`):** the claim above was
> FALSE as written for `packages/adapters/src/coding-project-secrets.test.ts` — at
> maker head `3b0d2b8c` that file had **2 FIXABLE biome issues**
> (`assist/source/organizeImports` + format), found by the TL's independent retest
> (`.super-speckit/qa/004-s3/tl-retest/RETEST-ROUND1.md`, §3). Fixed in fix round r1
> (commit `921f3242`, `biome check --write` on that one file only; re-check exits 0
> with 0 errors / 0 warnings). Original wording retained unedited above for history.
- `tsc --noEmit -p packages/adapters/tsconfig.json`: clean after every implementation
  commit; `prisma generate` run offline after each schema change (engines local).

## Commit list (base 1c0bb347 → HEAD)

1. `477241bf` — s3: T14 project secrets store (+ table + migration; 9 tests)
2. `ef8acafb` — s3: T18 audit chain (+ secretsAuditHead column + migration; 8 tests)
3. `7f66d3c0` — s3: T15/T19/T21-core grants service (+ grants table + migration; 14 tests)
4. `c45006a8` — s3: T16 + LOW-7 binding constraint in process-sandbox (10 tests)
5. `e3d947d5` — s3: T17 egress filter + executor scoping + checkpoint hook (11 tests + 112 seam regression)
6. `aff422d4` — s3: T20 doc annotation (4 tests)
7. `ec81b0a5` — s3: T21 doctor delegation + flow test + V9 grep gate (3+1 tests)
8. `222a491a` — s3: S3 evidence (EVIDENCE.md + validate transcript + patch provenance)
9. `f76669b9` — s3: evidence head correction (evidence-only)
(Any further evidence-only commits after these are part of this lane's record; the
authoritative lane-end tip ships in the lane report.)

Explicit paths only in every commit; no `git add -A`; no push.

## Checkpoint: validate + status strict

- `python3 .super-speckit/scripts/super_speckit.py validate` → **"super-speckit state valid"**
  (re-run at lane end; output in this file's verification transcript).
- Feature state remains `maker_running` (strict; state transitions belong to the
  orchestrator, not this lane).

## DEVIATIONS

1. **Session-start glue call-site not wired into the live run path (integration point
   documented, seams fully tested).** The full production chain is
   session start → `grantSecretsForRun` → `prepareTaskSecretInjection` (provider) +
   `deps.codingSecrets.egressValuesForRun` (executor). Each seam is red-first tested at
   its own layer (service → provider capability → executor dep → doctor predicate), but
   the ONE executor/adapter call-site that invokes them at session start is not wired
   in this lane. This mirrors S2 TRACKING LOW-6 (session-start `createTaskContext`
   wiring deferred to S5/Q7 — the setup-definition format itself lands in S5/T27).
   FLAGGED for the orchestrator: S5 must wire the call-site or explicitly re-scope.
2. **Production `LocalAgentHomeStore` constructors (apps/api, apps/worker) do not yet
   pass `egressFilter`** — the hook is opt-in by design (constructor unchanged for
   existing callers; no apps/web touch). Enabling checkpoint egress in production
   requires the granted-values source from deviation 1. FLAGGED alongside it.
   **(fix round r2, LOW-3): the executor `codingSecrets` dep is likewise unsupplied
   in production at BOTH `createRunExecutor` call-sites — `apps/api/src/app.ts:369`
   and `apps/worker/src/index.ts:171` — not only at the home-store constructors.**
3. **Audit JSONL location is caller-provided** (per-workspace path chosen by the
   integrator); the production default path is part of the same session-start wiring
   point as deviation 1. No silent default was invented.
4. No other deviations: ratified constants untouched; no apps/web changes; no codex
   cloud exec; no other bots' folders touched; no push; protected-path migrations are
   additive-only (two tables + one column across three migrations) and are flagged for
   the independent review the plan requires before merge.

## Routing needs

- Protected-path review (plan Risks): the three additive migrations
  (`20261002030000_coding_project_secrets`, `20261002031000_coding_session_secrets_audit_head`,
  `20261002032000_coding_secret_grants`) need independent review before merge.
- S5 hand-off: wire the session-start secrets call-site (deviation 1) together with the
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
    location when the lifecycle gets wired (no silent default was invented in S3).

## FIX ROUND r1 (s3-fix lane `rakazo-004-s3-fix-r1`, 2026-10-02)

Folds the TL retest round 1 findings at maker head `3b0d2b8c` — record:
`.super-speckit/qa/004-s3/tl-retest/RETEST-ROUND1.md` (TL-owned; NOT modified by this
lane). Lane start verified: HEAD `92c872afe9000125cfac77be2b630f947ab6ec80` on
`tl/004-purpose-gate-r1`, `git status --porcelain` empty. Explicit paths only, no push.

### Finding 1 — regression, FIXED (commit `209a8440`)
- `packages/db/src/coding-migration.test.ts` > "each coding migration is ordered after
  every earlier migration (timestamp-named directories)" failed: the hardcoded
  `CODING_MIGRATIONS` registry listed only the two S1-era entries, while S3 added three
  coding migrations unregistered — `20261002030000_coding_project_secrets`,
  `20261002031000_coding_session_secrets_audit_head`,
  `20261002032000_coding_secret_grants` — so they were classified non-coding and
  `other < CODING_MIGRATIONS[0]` failed. Pre-existing red evidence (TL full-suite run):
  `.super-speckit/qa/004-s3/tl-retest/round1-coding-migration-failure.txt`.
- Fix: the three migrations registered in timestamp order. Assertions NOT weakened —
  extended faithfully to what each `migration.sql` actually contains:
  - the audit-head migration's single `ALTER TABLE "coding_sessions" ADD COLUMN
    "secretsAuditHead" JSONB` is now the ONLY permitted non-CREATE statement form:
    a nullable column add on a coding table, with DEFAULT / NOT NULL / SET / USING /
    CONSTRAINT / REFERENCES / ALTER COLUMN / DROP / RENAME all still forbidden;
    > **CORRECTION (fix round r2):** the claim above was FALSE as written — DEFAULT
    > (and COLLATE / GENERATED / IDENTITY) were NOT in the negative lookahead until
    > fix round r2 (commit `ef0fba26`; reds `red/fix2-med2-red.txt` show all four
    > variants PASSing the gate pre-fix). Original wording retained for history.
  - `NEW_TABLES` grew to the four coding tables the schema actually maps
    (`coding_sessions`, `coding_workspace_leases`, `coding_project_secrets`,
    `coding_secret_grants`) — required because `schema.prisma` already carries the S3
    `@@map` entries (the "two new coding tables" premise was S1-era);
  - NEW test "the S3 secrets migrations contain exactly their declared additive
    statements": exact per-migration statement assertions taken from the actual SQL
    (project secrets: 3 statements incl. `workspaceId_name` unique index; audit head:
    exactly the one column add + schema declares `secretsAuditHead Json?`; grants:
    3 statements incl. `(workspaceId, taskRunId, secretName)` unique index).
- packages/db FULL suite (vitest, 18 files) — before/after:
  - BEFORE: **1 failed / 136 passed / 8 skipped (145 tests)**; sole failure = the
    ordering test at line 81 (reproduced locally; identical to the TL red). Nothing
    else in packages/db failed.
  - AFTER: **0 failed / 138 passed / 8 skipped (146 tests)** — suite green (exit 0;
    log `/home/rakazo/s3fix-db-after.log`). The +1 test is the new exact-statements test.

### Finding 2 — scoped lint, FIXED (commit `921f3242`)
- `packages/adapters/src/coding-project-secrets.test.ts`: exactly 2 FIXABLE issues —
  `assist/source/organizeImports` (imported-name sort) + formatter.
- `biome check` BEFORE: exit 1, "Found 2 errors" (both FIXABLE, captured in the lane
  transcript). `biome check --write` run on that ONE file only; `biome check` AFTER:
  exit 0, no errors, no warnings ("No fixes applied"). Targeted vitest on the file
  after the fix: 9 passed / 9 (import order is behavior-neutral; verified anyway).

### Pre-existing flake composition (note — not an S3 issue, not touched)
Per `RETEST-ROUND1.md`: computer-spec 2→1 across retest rounds is environmental
instability inside the pre-existing failure set (pr-digest 24 + playwright-artifact 3 +
computer-spec 1–2 = 28–29). This lane touches nothing in
infra/sandboxes/supervisor; recorded here for honest composition tracking only.

Fix-round tip: the latest commit on `tl/004-purpose-gate-r1` after `921f3242` (plus the
evidence commit for this section); see the lane report for the exact lane-end SHA.

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
