# QA summary — 001-multi-session-agents · Slice S4 · Run 1

**Candidate**: `730d717a` | **Branch**: `ss/qa/001-multi-session-agents-s4` | **Worktree**: `ss/qa/001-s4-run1` | **Date**: 2026-09-28

## Verdict: PASS ✅

## Gate results

| Gate | Result |
|---|---|
| `@rakazo/db` test suite (offline) | ✅ 131 passed / 8 skipped |
| `@rakazo/adapters` tsc `--noEmit` | ✅ 0 errors |
| V16 (repos aggregates, offline) | ✅ 7 tests pass |
| V17 (lease guard, real Postgres) | ✅ 2 tests pass (structural proof + real PG) |
| V18 (known v1 behaviors, doc audit) | ✅ 3 rows present in both spec and matrix |

## S4 rows (V16–V18)

| Row | Requirement | Result |
|---|---|---|
| V16 | Sidebar aggregates: `unread = OR over sessions`; `preview`/`status` from primary; `bots/duplicate` clones primary only | ✅ All 5 sub-assertions pass |
| V17 | Lease teardown guard: `deleteSession` never queries/mutates `computer_execution_leases` | ✅ Structural grep 0 matches + real Postgres run |
| V18 | Known v1 behaviors documented with reversal paths | ✅ 3 rows in spec.md + verification-matrix.md |

## Prior-run rows confirmed

| Row | Result |
|---|---|
| V1–V5, V8–V11 | ✅ Stand from S1 |
| V6–V7 | ✅ Stand from S2 |
| V12–V14 | ✅ Stand from S2 (DB-gated) |
| V15 | ✅ Stand from S3 |

## Findings

No new findings in S4 scope. One pre-existing failure (unrelated to S4): `space-membership.postgres.test.ts > adds a new organization member to its default Space` — not introduced by 730d717a, pre-existing on worktree.

## Diff scope

- `repos.ts`: Grill #9 `unread = OR` for `mapBot` + `listBots` + `listSpaceBotsForSpaces` (6 lines)
- `repos.test.ts`: +207 lines — V16 test blocks
- `sessions-lease-guard.postgres.test.ts`: +190 lines — V17 regression net
- `spec.md` + `verification-matrix.md`: +10 lines each — known v1 behaviors tables

## Recommendation

Ready for merge. All V16/V17/V18 rows verified. All prior rows (V1–V15) stand from prior QA runs. No open defects in S4 scope.
