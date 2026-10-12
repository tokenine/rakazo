# S3 TL independent retest — round 1 (2026-10-01, at maker head 3b0d2b8c)

Retest by Tech Lead (main thread, independent of maker lane). Full monorepo suite,
detached run, log /home/rakazo/s3-fullsuite-tl.log (535s).

## Numbers
- 4840 passed / 29 failed / 171 skipped (5040 total, 460 files).
- Delta vs S2 retest (4780/29/171, 4980 total, 451 files): +60 passed = the 60 new S3
  tests; +9 files = the 9 new S3 test files; +0 NET failed — BUT composition changed:

## VERDICT: NOT candidate-ready — 1 real S3-introduced failure

1. NEW FAILURE — packages/db/src/coding-migration.test.ts > "each coding migration is
   ordered after every earlier migration (timestamp-named directories)" (line 81).
   Root cause (verified on disk): CODING_MIGRATIONS registry in that test is hardcoded
   with only the two S1-era entries (20261001050500_coding_sessions_lease,
   20261002000000_coding_session_latest_run_idx). S3 added three coding migrations —
   20261002030000_coding_project_secrets, 20261002031000_coding_session_secrets_audit_head,
   20261002032000_coding_secret_grants — WITHOUT registering them, so the test classifies
   them as non-coding and fails `other < CODING_MIGRATIONS[0]`.
   The maker's scoped run (137/137) never executed the packages/db suites — seam gap.
   FIX: register the three S3 migrations in CODING_MIGRATIONS (timestamp order); re-run
   packages/db suite in full.
2. PRE-EXISTING FLAKE NOTE (honesty): computer-spec.test.ts shows 1 failed this run vs 2
   in the S2 retest round. S3 touches nothing in infra/sandboxes/supervisor — the
   pre-existing set is not perfectly stable run-to-run. Totals coinciding at 29 masked
   the composition change (-1 flake, +1 regression). Pre-existing set is now understood
   as: pr-digest 24 + playwright-artifact 3 + computer-spec 1–2 (flaky) = 28–29.

## Also found (scoped, not suite-visible)
3. biome: coding-project-secrets.test.ts has 2 FIXABLE issues (assist/source/
   organizeImports + format). Maker's EVIDENCE.md claim "scoped biome 0/0" is FALSE for
   this file. Fix with biome check --write on that file; correct the evidence claim.

## Other checks this round (all clean)
- Boundary: apps/web diff = 0 files in 1c0bb347..3b0d2b8. Nothing pushed.
- tsc --noEmit -p packages/adapters: clean.
- Biome on the other 17 touched ts files: clean.
- Suite start 09:50:08Z, duration 535.23s.
