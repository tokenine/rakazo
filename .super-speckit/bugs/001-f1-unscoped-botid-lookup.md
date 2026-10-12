# BUG-001-F1 — unscoped botId thread lookup in testkit authorization test throws at runtime on migrated schema

- Status: `closed`
- Found in: `001-multi-session-agents / candidate f68d7bfb / QA run 001-s1-run1`
- Affected requirement: `R6` (post-migration compatibility) + matrix row V10 (legacy pinning gate)
- Severity: `medium` (test-only file; deterministic failure of the database-gated lane; product code unaffected)
- Reproduction: `2/2` (real migrated Postgres; deterministic, not a flake)

## Expected / actual

Expected: every thread lookup keyed on `botId` alone is pinned to the primary session (`isPrimary: true`) after `Thread.botId @unique` was relaxed — matrix row V10.
Actual: `packages/testkit/src/authorization.test.ts:276` calls `thread.findUniqueOrThrow({ where: { botId } })`. Once the unique index is dropped, Prisma rejects the call at runtime with `PrismaClientValidationError` (unknown argument / non-unique field in findUnique where). The file is `VERIFY_DATABASE`-gated, so offline CI suites skip it and the defect surfaced only in the checker's real-Postgres lane.

## Minimal reproduction

1. Apply the full migration chain (including `20260928120000_multi_session_threads`) to a Postgres DB.
2. Run the database-gated testkit lane including `packages/testkit/src/authorization.test.ts`.
3. Observe `PrismaClientValidationError` at `authorization.test.ts:276`.

## Evidence

- QA report: `.super-speckit/qa/001-s1-run1/qa-report.md` (F-1 section, reproduced 2/2)
- Candidate: `f68d7bfb` on `ss/feature/001-multi-session-agents`
- Sanitization completed: yes

## Fix and regression obligation

- Bug-fix worktree/commit: `ss/bug/001-f1` from `f68d7bfb` — fix `81647881` (findFirstOrThrow + isPrimary:true; V10 gate wording extended to OrThrow variants)
- Regression test: done — fix carries the pinned lookup; V10 gate now covers `findFirst(/findUniqueOrThrow(/findFirstOrThrow(` (re-verified zero unscoped sites)
- Independent retest run: PASS (checker who did not author the fix; real-Postgres retest: new-shape lookup OK via product createDb probe, old-shape still errors side-by-side; V10 gate zero; qa-report.md §8)
