# Proof pack — 001 S1 run 1 (checker lane)

All paths relative to repo root (`/Users/poom-work/rakazo`). Candidate verified: `f68d7bfb` in worktree `~/.super-speckit-worktrees/ss/qa/001-run1`.

- `qa-report.md` — this run's report (verdicts, evidence, failure F-1)
- `logs/db-test.log` — db suite: 121 passed | 6 skipped, exit 0
- `logs/adapters-test.log` — adapters suite: 2011 passed | 25 skipped, exit 0
- `logs/api-test.log` — api suite: 389 passed, exit 0
- `logs/check.log` — `pnpm check`: 22/22 tasks, exit 0
- `logs/row-evidence-verbose.log` — verbose run of the 5 evidence files: 159 ✓ / 0 ✗, exit 0 (V2/V5/V9/V11 named tests)
- `logs/v4-deploy-pre.log` — truncated-chain deploy: 91 migrations, no session columns
- `logs/v4-deploy-full.log` — full deploy: only `20260928120000_multi_session_threads` applied; re-run: `No pending migrations to apply.`
- `logs/v4-assertions.log` — isPrimary=t, msgs=1, both new indexes, old unique dropped, second-primary insert rejected
- `logs/v4-probe-botid.log` — runtime probe: unscoped `findUniqueOrThrow({where:{botId}})` → `PrismaClientValidationError` (failure F-1, 2 reproductions)
- `tmp/prisma-pre/` — truncated migrations copy + QA-only `prisma.config.ts` (see report §4 gotcha)
- `tmp/probe-botid-unique.mts` — throwaway probe script (product `createDb` path)

Throwaway Postgres (`pg-001-check`, port 54329) was removed after evidence capture.

## Retest of F-1 (81647881)
- `logs/f1-retest-authorization.log` — full-env suite run on fix branch: 14/15 fail at signup (F-2), 1 pass
- `logs/f1-retest-authorization-prefix.log` — identical run at candidate f68d7bfb: same 14 signup 400s (F-2 pre-existing proof)
- `logs/f1-retest-probe.log` — FIXED-SHAPE-OK (thread-r1 primary) / OLD-SHAPE-ERROR PrismaClientValidationError on migrated pg-001-retest
- `tmp/probe-f1-retest.mts` — throwaway probe (product createDb path)

Retest DB `pg-001-retest` (port 54330) removed after evidence capture.

## Stacked retest (F-2 `0d893595`, F-3 `ae301f6e`)
- `logs/stacked-authorization.log` — 15/15, exit 0
- `logs/stacked-pi-offline.postgres.log` — 1/1, exit 0 (F-3 stall case)
- `logs/stacked-executor-lifecycle.log` — 21/21, exit 0
- `logs/stacked-mention-targets.log` — 7/7, exit 0
- `logs/stacked-journeys.log` — 36/37 (F-4: account-deletion password residue)
- `logs/stacked-journeys-repro2.log` — F-4 second reproduction (identical)
- `logs/stacked-db-offline.log` — 121/6, exit 0
- `logs/stacked-adapters-offline.log` — 2011/25, exit 0 (F-3 regression check)
- `tmp/run-suites-stacked.sh` — per-suite isolated-DB runner (harness semantics)

Retest DB `pg-retest3` (port 54333) removed after evidence capture.
