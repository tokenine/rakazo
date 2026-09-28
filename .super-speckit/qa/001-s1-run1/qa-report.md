# QA report — 001 Multi-session agents · Slice S1 · Run 1

- **Lane**: independent checker (did not build; product code untouched)
- **Candidate**: `f68d7bfb` — branch `ss/feature/001-run1` (worktree `ss/qa/001-run1`, detached at candidate)
- **Date**: 2026-09-28
- **Matrix**: `specs/001-multi-session-agents/verification-matrix.md`
- **Proof pack**: `.super-speckit/qa/001-s1-run1/` (see `proof-pack.md`)

## 1. Gates (all observed in the QA worktree, not trusted from maker)

| Gate | Command | Observed result | Verdict |
| --- | --- | --- | --- |
| db suite | `pnpm --filter @rakazo/db test` | `Tests 121 passed \| 6 skipped (127)`, exit 0 | ✅ matches expected 121/6 |
| adapters suite | `pnpm --filter @rakazo/adapters test` | `Tests 2011 passed \| 25 skipped (2036)`, exit 0 | ✅ matches expected 2011/25 |
| api suite | `pnpm --filter @rakazo/api test` | `Tests 389 passed (30 files)`, exit 0 | ✅ matches expected 389 |
| typecheck | `pnpm check` (turbo) | `Tasks: 22 successful, 22 total`, exit 0 | ✅ |

Logs: `logs/db-test.log`, `logs/adapters-test.log`, `logs/api-test.log`, `logs/check.log`.
Setup before gates: `pnpm install --frozen-lockfile` + `pnpm --filter @rakazo/db generate` (Prisma 7.10.0 client → `src/generated/prisma`).

## 2. V10 — legacy pinning grep gate (re-run by checker)

Full inventory of `thread.(findFirst|findUnique)(OrThrow)?(` across `packages/` + `apps/` (grep output preserved in this report §2.1):

**Product botId-only sites — 7/7 pinned via the repos helper `PRIMARY_SESSION_ORDER`** (`packages/db/src/thread-listing.ts:9-12` = `[{ isPrimary: "desc" }, { createdAt: "asc" }]`; imported, not raw):

| Site | Shape |
| --- | --- |
| `apps/api/src/messaging-inbound.ts:125` | `findFirst({ where: { botId: existing.botId }, orderBy: PRIMARY_SESSION_ORDER })` |
| `apps/api/src/messaging-inbound.ts:691` | same |
| `apps/api/src/messaging-inbound.ts:741` | same |
| `packages/db/src/messaging.ts:61` | same |
| `packages/db/src/messaging.ts:133` | same |
| `packages/db/src/messaging.ts:159` | same |
| `packages/adapters/src/messaging-delivery.ts:284` | same |

All other production hits are id-/groupId-scoped (`executor.ts:983,1230,4273`, `history-compaction.ts:220,456`, `repos.ts:684,702`, `thread-target.ts:281`), not botId-only. Relation navigations pin via `threads: { orderBy: PRIMARY_SESSION_ORDER }` + `[0]` (`repos.ts:95-96,175,329,409,550,563,633`; `events.ts:966`). Tests pin the exact call shape: `apps/api/src/messaging-inbound.test.ts:314-317`, `packages/adapters/src/messaging-delivery.test.ts:827-830`, `packages/db/src/messaging.test.ts:114-117` (all observed passing, §3).

Note on gate wording: the sites use the shared `PRIMARY_SESSION_ORDER` repos helper (primary-first ordering) rather than a literal `isPrimary: true` where-predicate; the matrix row V10 evidence ("all 7 sites") is functionally satisfied and test-pinned. The partial-unique index (§4) makes `isPrimary desc` ordering deterministic at the DB level.

**Testkit/CLI sites — 9/10 primary-scoped, 1 deviation:**

Scoped (`isPrimary: true` predicate): `testkit/src/bot-secrets.test.ts:338`, `executor-lifecycle.test.ts:868`, `journeys.test.ts:429,1131,1246`, `messaging.test.ts:114,135`, `runs-list.test.ts:195-196`, `cli/mobile-screenshots.ts:226`. By groupId/id (fine): `executor-lifecycle.test.ts:580`, `journeys.test.ts:471,2184`, `runs-list.test.ts:155`, `mobile-screenshots.ts:227`.

⛔ **Deviation**: `packages/testkit/src/authorization.test.ts:276-278` — unscoped `handles.prisma.thread.findUniqueOrThrow({ where: { botId: ownerBot.id } })` (no `isPrimary`, no ordering). See §5 Failure F-1.

## 3. Row evidence (named tests, each observed passing by this checker)

Verbose run (`logs/row-evidence-verbose.log`, exit 0, 159 ✓, 0 ✗):
`vitest run packages/db/src/repos.test.ts apps/api/src/thread-target.test.ts apps/api/src/messaging-inbound.test.ts packages/adapters/src/messaging-delivery.test.ts packages/db/src/messaging.test.ts --reporter=verbose`

- **V2** — `packages/db/src/repos.test.ts > createRepos.listSessions > keeps each session's history independent (V2)` ✓ (also `orders the primary first, then remaining sessions by most recent activity` ✓)
- **V5** — `apps/api/src/messaging-inbound.test.ts > createMessagingInboundHandler DM routing > pins the known-sender thread lookup to the primary session, then earliest` ✓; peer DM delivery unchanged: `packages/adapters/src/messaging-delivery.test.ts > deliverMessagingOutbound channel runs > pins peer fan-out to the peer bot's primary session, then earliest` ✓
- **V9** — `apps/api/src/thread-target.test.ts > resolveThreadTarget`: `pins botId-only input to the bot's primary session` ✓, `resolves an explicit threadId the actor owns as a session of that bot` ✓, `rejects an explicit threadId outside the actor's sessions of that bot` ✓
- **V11** — `packages/db/src/repos.test.ts > createRepos.createSession > never creates a second primary for the same bot (V11 partial-index invariant)` ✓ + real-Postgres partial-unique rejection (§4) + `packages/db/src/messaging.test.ts > provisionMessagingIdentity > pins the identity thread lookup to the primary session, then earliest` ✓ + `repos.test.ts > bot session pinning in bot DTOs > maps threadId and unread from the primary session, not the oldest session` ✓. Note: no literal `getPrimaryThread` helper exists; the seam realizes it as `PRIMARY_SESSION_ORDER` + `threads[0]` (`repos.ts:95-96`, `events.ts:966`) — covered by the named passing tests above.

## 4. V4 — lossless migration on real Postgres (checker-only item)

Env: `docker run -d --name pg-001-check -e POSTGRES_PASSWORD=check_pw -p 54329:5432 postgres:16-alpine`; `DATABASE_URL=postgresql://postgres:check_pw@localhost:54329/postgres`. Container removed after evidence capture.

Gotcha re-recorded for future runs: `packages/db/prisma.config.ts` pins `migrations.path = "prisma/migrations"` relative to **CWD**, so `--schema <copy>/schema.prisma` alone does not redirect the migrations source. The truncated deploy must run with CWD = the copy and a QA-local `prisma.config.ts` (kept at `tmp/prisma-pre/prisma.config.ts`).

1. **Pre-migration schema**: copy of `packages/db/prisma` minus `migrations/20260928120000_multi_session_threads`, deployed from that dir → `91` migrations applied, exit 0 (`logs/v4-deploy-pre.log`). `threads` has **no** `isPrimary`/`name`/`lastMessageAt` columns (information_schema count 0).
2. **Fixtures via psql** (schema-derived required columns: org → space → bot(`createdAt`,`updatedAt` have no DB default) → thread → message):
   `organization(org-1)`, `spaces(space-1)`, `bots(bot-1)`, `threads(thread-1, botId='bot-1')` — pre-migration `threads_botId_key` unique present — `messages(msg-1, thread-1, seq 0)`. Counts verified 1/1/1.
3. **Full deploy** (CWD `packages/db`, its own config): `92 migrations found` → **only `20260928120000_multi_session_threads` applied**, exit 0 (`logs/v4-deploy-full.log`).
4. **Assertions** (`logs/v4-assertions.log`):
   - `thread-1`: `isPrimary = t`; message still attached (`msgs = 1`); `name`/`lastMessageAt` null.
   - `pg_indexes`: `threads_botId_idx` (plain btree) ✓ and `threads_botId_isPrimary_key` = `CREATE UNIQUE INDEX ... ON threads USING btree ("botId") WHERE ("isPrimary" AND ("botId" IS NOT NULL))` ✓.
   - Legacy `threads_botId_key` gone (count 0) ✓.
   - Second `isPrimary=true` thread for `bot-1` **rejected**: `ERROR: duplicate key value violates unique constraint "threads_botId_isPrimary_key"` (psql exit 3 under `ON_ERROR_STOP` — expected positive) ✓.
   - Control: second **non-primary** session `thread-3` inserts fine (multi-session allowed; partial index does not over-block) ✓.
   - **Idempotency**: re-run `prisma migrate deploy` → `No pending migrations to apply.` ✓.
5. **Runtime probe** (`tmp/probe-botid-unique.mts` via product `createDb`, `logs/v4-probe-botid.log`): the exact unscoped `findUniqueOrThrow({ where: { botId } })` shape left in testkit throws `PrismaClientValidationError` against the migrated schema (§5).

Bot DTO threadId-unchanged portion of V4 is covered at seam level by `repos.test.ts > maps threadId and unread from the primary session` (§3) — the migrated thread IS the primary, so the DTO pins to the same row.

## 5. Failures

**F-1 — deterministic test defect (only failure found).**
`packages/testkit/src/authorization.test.ts:276-278` still uses botId-only `thread.findUniqueOrThrow({ where: { botId } })`. It typechecks (Prisma extended where-unique types admit non-unique fields) but throws `PrismaClientValidationError` at runtime against the migrated schema. Reproduced **2×** via `tmp/probe-botid-unique.mts` on the real migrated Postgres (`logs/v4-probe-botid.log`; both runs identical error) — deterministic, not a flake. Blast radius: the file is `describeWithDatabase`-gated (`VERIFY_DATABASE === "1" && DATABASE_URL`, line 31-34) so it **skips** in offline CI (gates stay green) and **fails** the moment the integration harness runs it. Product code unaffected; all other testkit/CLI sites were migrated. Classification: **deterministic / test-defect / S1 leftover**. Fix belongs to a new maker lane (checker does not fix): scope it like the sibling sites, e.g. `findFirstOrThrow({ where: { botId, isPrimary: true } })`.

No other failures: 0 test failures across 3 suites + typecheck; V4 assertions all green on first execution (each deterministic SQL/CLI check, no repetition needed).

## 6. Per-row verdicts (S1 matrix rows)

| Row | Verdict | Evidence |
| --- | --- | --- |
| V1 create/list sessions (S1/S2) | **verified — S1 seam portion** (RPC-level test lands S2) | `repos.test.ts > listSessions > returns the bot's sessions ... keeping the requested ordering` ✓, `> orders the primary first, then remaining sessions by most recent activity` ✓, `createSession > creates a named, non-primary session for an owned bot` ✓ (`logs/row-evidence-verbose.log`) |
| V2 independent histories | **verified** | `repos.test.ts > keeps each session's history independent (V2)` ✓ |
| V3 computer lease exception | **verified** | adapters suite 2011 passed incl. `computer-control.test.ts > requires every persisted lease boundary to authorize control` et al. (per-bot serialization untouched); testkit `executor-lifecycle` integration variants are `VERIFY_DATABASE`-gated (skip offline) — same gating as pre-change |
| V4 lossless migration | **verified** | §4 real-Postgres run (this checker) |
| V5 inbound lands primary | **verified** | `messaging-inbound.test.ts > pins the known-sender thread lookup to the primary session, then earliest` ✓ + `messaging-delivery.test.ts > pins peer fan-out ... primary session` ✓ |
| V8 legacy compatibility (S1-S3) | **verified — S1 router portion** | api suite 389 passed unmodified (botId-only inputs land on primary via `resolveThreadTarget`); web e2e re-check belongs to CI/S2-S3 checkpoints |
| V9 explicit threadId + botId-only | **verified** | `thread-target.test.ts > resolveThreadTarget` 3 tests ✓ (§3) |
| V10 legacy pinning grep gate | **not verified — 1 unscoped site remains** | Product 7/7 pinned (§2) + shape-pinning tests ✓; ⛔ `testkit/src/authorization.test.ts:276` unscoped → F-1 |
| V11 one-primary invariant | **verified** | `repos.test.ts > never creates a second primary for the same bot (V11 partial-index invariant)` ✓ + real-Postgres unique-violation rejection (§4); helper realized as `PRIMARY_SESSION_ORDER`+[0] (§3 note) |
| V12–V17 (S2–S4 rows) | **not applicable — this run** | Out of S1 scope; not executed |
| V18 known v1 behaviors | **not applicable** (S4, listed per policy) | (a) bot-level memory shared across sessions — accepted v1 behavior; (b) `clearThread` bumps `bot.updatedAt` — accepted v1 behavior. Both to be re-listed in the S4 QA summary |

## 7. Overall verdict

**PASS** *(as of the F-1 retest, §8; initially FAIL on F-1 alone)*.
All four gates pass with checker-observed numbers (db 121/6, adapters 2011/25, api 389, check 22/22); V2/V5/V9/V11 verified with named passing tests; V4 verified end-to-end on real Postgres including idempotency and partial-index enforcement. The single run-1 defect F-1 (unscoped botId-only `findUnique` at `packages/testkit/src/authorization.test.ts:276`) was fixed at `81647881` and verified by retest (§8): diff exact, V10 grep gate green under the updated wording, fixed call shape proven on real migrated Postgres. New pre-existing finding F-2 (§8.3) is out of S1 scope and filed for its own lane; it does not affect any matrix row below.

## 8. Retest of F-1 (bug lane 81647881, branch `ss/bug/001-f1`) — 2026-09-28

Retest requested by Main; checker did not author the fix. Worktree: `~/.super-speckit-worktrees/ss/bug/001-f1` (node_modules pre-installed), parent = candidate `f68d7bfb`.

### 8.1 Diff verification — PASS

`git show 81647881` = exactly 2 files, 3 insertions / 3 deletions, nothing else:

- `packages/testkit/src/authorization.test.ts:276-278`: `findUniqueOrThrow({ where: { botId: ownerBot.id } })` → `findFirstOrThrow({ where: { botId: ownerBot.id, isPrimary: true } })`
- `specs/001-multi-session-agents/verification-matrix.md` V10 wording: grep gate now over `thread.findFirst(`/`thread.findUniqueOrThrow(`/`thread.findFirstOrThrow(` where-clauses keyed on `botId` alone across `packages/` + `apps/`, id-/groupId-scoped exempt, product sites pinned via `PRIMARY_SESSION_ORDER` **or** `isPrimary: true`.

### 8.2 V10 grep gate under new wording — PASS (re-run on fix worktree)

Full `thread.(findFirst|findUnique)(OrThrow)?(` inventory over `packages/` + `apps/`: **zero unscoped botId-only lookups**. The former F-1 site now carries `isPrimary: true` (authorization.test.ts:276-277); all other botId-only sites unchanged and pinned (`PRIMARY_SESSION_ORDER` ×7 product; `isPrimary: true` at bot-secrets/executor-lifecycle/journeys/messaging/runs-list/mobile-screenshots); remaining hits id-/groupId-scoped (exempt).

### 8.3 Real-Postgres retest — F-1 fix PASS; separate pre-existing blocker found (F-2)

DB: `pg-001-retest` (postgres:16-alpine, port 54330), full chain deployed → only pending `20260928120000_multi_session_threads` applied, `All migrations have been successfully applied.` Fixtures: org/space/bot + two threads (`thread-r1` primary "Main", `thread-r2` non-primary "Side").

**Probe via product `createDb`** (`tmp/probe-f1-retest.mts`, log `logs/f1-retest-probe.log`):

```
FIXED-SHAPE-OK: thread-r1 isPrimary: true name: Main
OLD-SHAPE-ERROR: PrismaClientValidationError
```

The exact fixed call shape executes on the migrated schema and returns the bot's primary session; the old shape still reproduces the original F-1 error on the same DB (symmetric confirmation).

**Suite-level execution blocked by F-2 (pre-existing, not the fix):** running `vitest run packages/testkit/src/authorization.test.ts` with the full harness env (`VERIFY_DATABASE=1`, `DATABASE_URL=…:54330`, mirrored `SIGNUPS_ENABLED=true` etc. from `packages/testkit/src/cli/harness.ts:55-79`) fails 14/15 tests at the signup helper (`authorization.test.ts:1456` → `/api/auth/sign-up/email`) with `400 EMAIL_PASSWORD_SIGN_UP_DISABLED` — before line 276 is ever reached. Root cause: `createAuth` (`packages/auth/src/index.ts:42-48`) configures better-auth passwordless-only (no `emailAndPassword` block; commit `ee119502`, which is on `origin/main`), while all DB-gated testkit suites still sign up via the email+password route. **Reproduced identically at candidate `f68d7bfb`** (14/15 same 400s, `logs/f1-retest-authorization-prefix.log`) and at fix `81647881` (`logs/f1-retest-authorization.log`) → deterministic, pre-existing at the S1 candidate, **not introduced or affected by 81647881**. Classification: pre-existing test-defect (or lane gap) in the integration harness auth path; needs its own lane; out of F-1 scope.

Offline behavior of the edited file unchanged: `vitest run packages/testkit/src/authorization.test.ts` without DB → `15 skipped`, and `tsc --noEmit -p packages/testkit` exit 0.

### 8.4 Retest verdict

**F-1: FIXED — verified.** Diff exact (8.1), V10 gate green under the new wording (8.2), fixed call shape proven on real migrated Postgres with the old shape still failing side-by-side (8.3). Full-suite green-through-line-276 is not observable on this branch due to F-2, which reproduces identically without the fix.

**F-2 (new, pre-existing):** passwordless-only auth vs email+password signup helpers blocks every DB-gated testkit suite at signup. Deterministic; 2 reproductions (candidate + fix SHAs). Recommend a separate maker lane; does not affect any S1 matrix row verdict below.

## 9. Stacked retest (F-2, F-3) — branch `ss/bug/001-f3`, tip `ae301f6e` — 2026-09-28

Stack: `ae301f6e` (F-3) → `0d893595` (F-2) → `81647881` (F-1) → `f68d7bfb`. Checker did not author any fix. Worktree `~/.super-speckit-worktrees/ss/bug/001-f3`.

### 9.1 Diff verification

- **F-1 `81647881`**: 2 files — testkit pin + V10 matrix wording (verified in §8).
- **F-2 `0d893595`**: exactly **13 files, all under `packages/testkit/`** (`git diff --name-only 81647881 0d893595`; 0 paths outside testkit). Adds shared `otpSignUp`/`otpCode` helpers to `testkit/src/index.ts` (drives `/email-otp/send-verification-otp` → `/sign-in/email-otp`, reads the code from `EmailEmulator`); rewires the 12 DB-gated suites. **Product auth config untouched** — confirmed by path scope.
- **F-3 `ae301f6e`**: **1 file, 1 line** — `packages/adapters/src/executor.ts:3650` `thread: { isNot: null }` → `threads: { some: {} }` (bot-directory peer query on the flipped 1:many relation). Nothing else.

### 9.2 V10 gate under current matrix wording — PASS

Re-ran the full `thread.(findFirst|findUnique)(OrThrow)?(` inventory over `packages/` + `apps/` at the tip: **zero unscoped botId-only lookups**. F-1 site (now authorization.test.ts:279-280 after F-2 edits) carries `isPrimary: true`; 7 product sites pinned via `PRIMARY_SESSION_ORDER`; all other testkit/CLI botId lookups `isPrimary: true`; remaining hits id-/groupId-scoped (exempt).

### 9.3 Real-Postgres end-to-end (fresh `pg-retest3` :54333, full migrate deploy, per-suite isolated template-clone DBs mirroring harness.ts semantics; runner `tmp/run-suites-stacked.sh`)

| Suite | Observed | Expected | Verdict |
| --- | --- | --- | --- |
| authorization.test.ts | **15/15 passed**, exit 0 (`logs/stacked-authorization.log`) | 15/15 | ✅ includes the F-1 line — full suite now runs past signup **and** the primary-pinned lookup |
| pi-offline.postgres.test.ts | **1/1 passed**, exit 0 (`logs/stacked-pi-offline.postgres.log`) | 1/1 | ✅ F-3 stall case: full journey past Run setup (bot-directory query no longer throws PrismaClientValidationError) |
| executor-lifecycle.test.ts | **21/21 passed**, exit 0 (`logs/stacked-executor-lifecycle.log`) | 21/21 | ✅ re-observed by checker, not trusted from FixerF3 |
| mention-targets.test.ts | **7/7 passed**, exit 0 (`logs/stacked-mention-targets.log`) | 7/7 | ✅ |
| journeys.test.ts | **36/37 passed** (1 failed), exit 1 (`logs/stacked-journeys.log`) | bonus | ⚠ new finding F-4 below |

Offline regression at the tip: db **121 passed | 6 skipped** exit 0 (`logs/stacked-db-offline.log`); adapters **2011 passed | 25 skipped** exit 0 (`logs/stacked-adapters-offline.log`; checker-added because F-3 touches adapters).

### 9.4 F-3 sweep verdict — exactly one defect

Swept the tip for singular `thread:` where-filters and `bot.thread` navigations across product code. Findings beyond the fixed executor.ts:3650:

- `packages/db/src/external-conversations.ts:20` `thread: { isNot: null }` — **valid**: `ExternalConversation.thread Thread?` is a 1:1 back-relation (`Thread.externalConversationId @unique`), not the flipped Bot→Thread relation.
- `executor.ts:4493` `thread: { select: { groupId: true } }` — **valid**: belongs-to `Run.thread` (runs reference threadId).
- `thread-target.ts:277`, `router.ts:2034,2132,2164-2167` `bot.thread?.id` — **valid**: `bot` is the repos-mapped DTO whose `thread` is derived from `threads[0]` (repos.ts:95-96), covered by the V9/V2 named tests.

**Verdict: exactly one defect of the F-3 class existed (executor.ts:3650), and ae301f6e fixes it.**

### 9.5 New finding F-4 — journeys #11 account deletion still uses the password flow (F-2 residue, test-side)

`packages/testkit/src/journeys.test.ts:1521-1531` ("11: deleting an account removes the user and personal workspace data") posts `/api/auth/delete-user` with `body: { password: "password12" }`. better-auth's delete-user route requires a credential account when a password is supplied (`update-user.mjs`: `if (ctx.body.password) { if (!account || !account.password) throw CREDENTIAL_ACCOUNT_NOT_FOUND }`); OTP users created by `otpSignUp` have no password credential → deterministic 400, `expected 400 to be 200`. **Reproduced 2×** on isolated databases (`logs/stacked-journeys.log`, `logs/stacked-journeys-repro2.log`; identical failure). Classification: deterministic test-defect, F-2 migration residue (the OTP conversion missed this password-dependent call; the product path itself supports passwordless deletion via fresh-session or token per the route schema). Not caused by F-1/F-3; does not affect any S1 matrix row (journeys account-deletion is not a matrix row). Recommend a follow-up maker lane: drop the password (fresh OTP session suffices per route: `freshAge` check) or use the token flow. Remaining password-based signup calls live only in non-integration lanes (e2e/canary/CLI scripts) — out of scope here.

### 9.6 Stacked retest verdicts

- **F-1 (81647881): PASS** — authorization 15/15 on real Postgres through the fixed lookup (§9.3).
- **F-2 (0d893595): PASS with residue** — all four required suites plus journeys boot and run on the passwordless flow; one residue F-4 (§9.5) in journeys #11 only.
- **F-3 (ae301f6e): PASS** — pi-offline 1/1 and executor-lifecycle 21/21 re-observed by checker; sweep confirms exactly one defect of this class existed (§9.4); adapters offline 2011/25.
- **Overall S1 gate: PASS (unchanged).** All run-1 row verdicts stand; F-4 is filed for a new lane and touches no matrix row.

## 10. Retest of F-4 (5262c142, branch `ss/bug/001-f4`) — 2026-09-28 — FINAL

### 10.1 Diff verification — PASS

`git show 5262c142`: **single file** `packages/testkit/src/journeys.test.ts`, **+3/−1** (2 insertions are the explanatory comment). Change: journeys #11 `/api/auth/delete-user` body `{ password: "password12" }` → `{}` — passwordless fresh-session deletion, product config untouched. Stacked correctly on `ae301f6e`.

### 10.2 Real-Postgres re-observation — PASS

Fresh container `pg-retest4` (:54334), full `prisma migrate deploy` (all migrations applied), per-suite isolated template-clone database (harness semantics; runner `tmp/run-suites-f4.sh`):

```
packages/testkit/src/journeys.test.ts => exit 0 | Test Files 1 passed (1) | Tests 37 passed (37)
```

Log: `logs/f4-journeys.log` (37/37; this file supersedes the §9 stacked-run journeys log — the original F-4 failure evidence is preserved in `logs/stacked-journeys-repro2.log` and quoted in §9.5). Offline spot-check: db **121 passed | 6 skipped**, exit 0 (`logs/f4-db-offline.log`).

### 10.3 Final S1 verdict — all bug loops closed

| Bug | Fix | Verdict |
| --- | --- | --- |
| F-1 unscoped botId `findUniqueOrThrow` (testkit) | `81647881` | **FIXED** — authorization 15/15 on real Postgres through the pinned lookup (§8, §9.3) |
| F-2 passwordless auth vs email+password test signup | `0d893595` | **FIXED** — all DB-gated suites boot via OTP; 13-file testkit-only diff (§9.1, §9.3) |
| F-3 executor bot-directory `thread:{isNot:null}` on 1:many | `ae301f6e` | **FIXED** — pi-offline 1/1, executor-lifecycle 21/21 re-observed; sweep: exactly one defect of the class (§9.3, §9.4) |
| F-4 journeys #11 password-based delete-user | `5262c142` | **FIXED** — journeys 37/37 on real Postgres (§10.2) |

**Overall S1 gate: PASS — final.** All run-1 row verdicts stand (V1/V8 S1 portions; V2, V3, V4 real-Postgres, V5, V9, V11 named tests; V10 clean at tip under current wording; V12–V17 out of scope; V18 not-applicable). No open findings. Stack reviewed tip-to-toe: `5262c142` → `ae301f6e` → `0d893595` → `81647881` → `f68d7bfb`.
