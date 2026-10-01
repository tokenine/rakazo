# 004-code-mode — Slice 3 (Secrets subsystem, Q10) EVIDENCE

Lane: **`rakazo-004-s3-maker-r1`** (maker; super-speckit maker ≠ checker)
Base SHA: **`1c0bb3479c005e8f38b450ef344b51126eabafe9`** (verified: `git rev-parse HEAD` at lane start; `git status --porcelain` empty)
Branch: `tl/004-purpose-gate-r1` — NO push (per lane rules)
Final HEAD SHA: **`222a491a`** (implementation HEAD `ec81b0a5` + this evidence commit;
see commit list below; `apps/web` untouched — `git diff 1c0bb347..HEAD --stat -- apps/web` is empty)

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
  transcripts/reviews/memory (granted values enter the existing runSecrets redaction
  path via the same dep), **checkpoints** (`LocalAgentHomeStore` egressFilter hook,
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
  LOW-6 `createTaskContext` setup-definition wiring.
