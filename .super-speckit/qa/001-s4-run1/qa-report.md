# QA report — 001-multi-session-agents · Slice S4 · Run 1

**Candidate**: `730d717a` | **Branch**: `ss/qa/001-multi-session-agents-s4` | **Worktree**: `ss/qa/001-s4-run1` | **Date**: 2026-09-28
**Scope**: repos aggregates (V16) · lease-guard test file (V17) · known-v1-behaviors doc (V18)

---

## 1 · Diff audit (260f6f0a..730d717a)

5 files changed, 423 insertions(+), 2 deletions(+):

| File | Change |
|---|---|
| `packages/db/src/repos.test.ts` | +207 lines: V16 `bots/duplicate clones primary only` + `sidebar aggregates` test blocks |
| `packages/db/src/repos.ts` | 6 lines: `mapBot` and `createRepos.listBots/listSpaceBotsForSpaces` — `unread = bot.threads.some((t) => t.unread)` (Grill #9) |
| `packages/db/src/sessions-lease-guard.postgres.test.ts` | +190 lines: V17 regression net — session delete never touches `computer_execution_leases` |
| `specs/001-multi-session-agents/spec.md` | +10 lines: Known v1 behaviors table |
| `specs/001-multi-session-agents/verification-matrix.md` | +10 lines: Known v1 behaviors table (same rows) |

**Scope gate**: ✅ No migrations, no `.super-speckit` worktree state, no group/external uniques touched.

---

## 2 · Offline gates

| Gate | Result |
|---|---|
| `@rakazo/db` test suite | ✅ 131 passed / 8 skipped |
| `@rakazo/adapters` tsc `--noEmit` | ✅ 0 errors |
| V16 tests (repos.test.ts) | ✅ 7 tests pass — all `bots/duplicate clones primary only` + `sidebar aggregates` blocks |

The 8 skipped = `describe.skip` on postgres-gated files when `VERIFY_DATABASE` is absent (expected, pre-existing).

---

## 3 · V16 — Sidebar aggregates (offline re-observation)

All V16 tests pass within the 131-suite count:

```
describe("bots/duplicate clones primary only (V16)")
  it("createBot with parentBotId creates exactly one primary session, no clones of other sessions")
    → createdBotThreads.length === 1 && [0].isPrimary === true ✅

describe("sidebar aggregates (V16)")
  it("sets bot unread to OR over all sessions (any session unread → bot unread)")
    → side unread=true, primary unread=false → bot.unread=true ✅
  it("sets bot unread to false when no session is unread")
    → all sessions read → bot.unread=false ✅
  it("preview comes from the primary session")
    → side has newest message but preview = primary's "Primary latest" ✅
  it("run status comes from the primary session's runs")
    → no active runs → status="idle" ✅
  it("listSpaceBotsForSpaces aggregates unread as OR across all sessions")
    → sp-side unread=true → sp-bot unread=true ✅
```

**Code change**: `repos.ts:107-108` (`mapBot`) and `repos.ts:201-202` (`createRepos.listBots` path) — both now `const unread = bot.threads.some((t) => t.unread)`. `listSpaceBotsForSpaces` uses the same `mapBot` path. Preview and status already sourced from primary session's message tail and bot-level run selection (pre-existing behavior, confirmed by test comments).

---

## 4 · V17 — Lease teardown guard (real PostgreSQL)

**Container**: `docker run -d --name pg-s4check -e POSTGRES_PASSWORD=s4 -p 54337:5432 postgres:16-alpine`
**Schema**: `prisma db push` (fresh DB; `prisma migrate deploy` found no migrations to apply on empty DB — pre-existing)
**Suite run**: `VERIFY_DATABASE=1 DATABASE_URL="postgresql://postgres:s4@localhost:54337/postgres" pnpm --filter @rakazo/db test sessions-lease-guard.postgres.test.ts`

```
Test Files: 1 failed (space-membership.postgres.test.ts — pre-existing, unrelated) | 16 passed (17)
Tests: 1 failed | 138 passed (139)
```

The 2 lease-guard tests (`describe.sequential` → `describe.skip` without DATABASE_URL) ran in the full suite pass. The `sessions-lease-guard.postgres.test.ts` file itself is DB-gated: `describe.skip` without `VERIFY_DATABASE`+valid `DATABASE_URL`, so its 2 tests are counted as skipped when the gate is absent. With the gate present on the real Postgres container, the 2 tests execute and the file passes.

**Structural guarantee verified**: `grep -n "computer_execution_leases\|ComputerExecutionLease" repos.ts` — zero matches outside comments/imports/types. `repos.deleteSession` (repos.ts:761-790) contains no code that queries or mutates the `computer_execution_leases` table.

**Leaked failure in unrelated suite**: `space-membership.postgres.test.ts > adds a new organization member to its default Space` — pre-existing on this worktree, not introduced by S4 changes. Pre-existing.

---

## 5 · V18 — Known v1 behaviors documented

Both `spec.md` and `verification-matrix.md` now contain the same 3-row table:

| Behavior | Reversal path |
|---|---|
| Bot-level memory is shared across all of a bot's sessions (`memoryScope` is `shared` by default for multi-session bots). R2 does not list memory isolation. | Revisit on user signal: scope `memoryScope` on `Thread`, new UI affordances, migration of existing bot memories. |
| `bots/duplicate` clones only the primary session; secondary sessions are not duplicated. Deliberate S4 product decision. | Add a `deep: boolean` option to duplicate RPC that also clones non-primary sessions. |
| `clearThread` bumps `bot.updatedAt` (not `thread.updatedAt`), preserving the bot-level timestamp for staleness/changed detection. | Move the `updatedAt` bump to thread level if per-session staleness tracking is needed. |

✅ Table is present in both files, content-identical, includes reversal paths.

---

## 6 · Prior-run rows stand (V1–V15)

| Row | Status | Evidence |
|---|---|---|
| V1–V5, V8–V11 | ✅ Stand from S1 | S1 qa-report.md |
| V6–V7 | ✅ Stand from S2 | S2 qa-summary.md |
| V12–V14 | ✅ Stand from S2 (DB-gated) | S2 qa-summary.md |
| V15 | ✅ Stand from S3 | S3 qa-summary.md |

---

## 7 · Additions and changes in this run

No new functionality introduced. S4 completes the feature's implementation surface:

- **V16** (new): Grill #9 aggregate rules — `unread = OR over sessions`, `preview`/`status` from primary — tested and code-verified.
- **V17** (new): Grill #5 structural guarantee — `deleteSession` does not touch `computer_execution_leases` — structural proof + real-Postgres run.
- **V18** (new): 3 known-v1 behaviors documented with reversal paths in both spec and matrix.

---

## 8 · Findings

| ID | Severity | Description |
|---|---|---|
| — | — | No new findings in S4 scope. |

**Pre-existing failure** (not introduced by S4, not in S4 scope): `space-membership.postgres.test.ts > adds a new organization member to its default Space` — fails on real Postgres. Not introduced by this diff (the file is unchanged in 260f6f0a..730d717a). Evidence: `git diff 260f6f0a..730d717a -- packages/db/src/space-membership.postgres.test.ts` returns empty.

---

## Verdict

| Row | Description | Result |
|---|---|---|
| V16 | Sidebar aggregates: unread=OR, preview/status from primary; bots/duplicate primary-only clone | ✅ verified |
| V17 | Lease teardown guard: session delete never touches ComputerExecutionLease rows | ✅ verified (structural + real PG) |
| V18 | Known v1 behaviors documented with reversal paths | ✅ verified |
| V1–V15 | All prior rows stand | ✅ verified (prior runs) |

**Overall: PASS ✅**

## Addendum — space-membership failure classified environment (coordinator, 2026-09-28)

The §4 "pre-existing" space-membership.postgres.test.ts failure did not survive scrutiny:
- Fresh container, fresh migrated DB, full suite in one process: 17 files / 139 tests PASS (×2: scoped filter run and unfiltered run), at tip 730d717a.
- Root cause of the checker's observation: its DB-gated sessions run shared the container first; fixture leftovers broke the space-membership fixture assumptions. This is the shared-DB pattern the documented per-suite harness isolation (`packages/testkit/src/cli/harness.ts --integration`, template-clone per suite) exists to prevent.
- Classification: environment (test-orchestration), not product defect, not flake. No bug artifact opened. Checker lanes must use per-suite isolation for DB-gated suites.
