# BUG-001-F2 — database-gated testkit suites cannot sign up: passwordless-only createAuth rejects email+password sign-up

- Status: `confirmed`
- Found in: `001-multi-session-agents / candidate f68d7bfb and fix 81647881 / QA run 001-s1-run1 retest` — pre-existing on `origin/main` (introduced by `ee119502`), NOT caused by slice S1 or the F-1 fix
- Affected requirement: test infrastructure for all `VERIFY_DATABASE`-gated lanes (matrix V4/V5/V10/V11 full-suite execution)
- Severity: `medium` (blocks the end-to-end database-gated testkit lane; no product behavior affected; S1 rows were verified via product-seam probes + offline suites)
- Reproduction: `2/2` (identical at f68d7bfb and 81647881; deterministic)

## Expected / actual

Expected: DB-gated testkit suites bootstrap an account and run the full authorization flow against a real database.
Actual: `createAuth` is passwordless-only since `ee119502` (on origin/main; betterAuth config has no `emailAndPassword`), while testkit suites sign up via `/api/auth/sign-up/email` → `400 EMAIL_PASSWORD_SIGN_UP_DISABLED` before reaching any test body (14/15 authorization tests fail at signup under `VERIFY_DATABASE=1` harness env).

## Minimal reproduction

1. Start the app/test server from a tree containing `ee119502`.
2. Run any `VERIFY_DATABASE`-gated testkit suite (e.g. `packages/testkit/src/authorization.test.ts`).
3. Observe `400 EMAIL_PASSWORD_SIGN_UP_DISABLED` from the sign-up call.

## Evidence

- QA report: `.super-speckit/qa/001-s1-run1/qa-report.md` §8 (F-2 classification; reproduced 2/2 at both SHAs)
- Sanitization completed: yes

## Fix and regression obligation

- Bug-fix worktree/commit: own lane (not part of slice S1) — next automatic probe: read `createAuth` at `ee119502` to identify the exposed passwordless flow (OTP/passkey), then align the testkit sign-up helper to that flow, or add a test-mode auth toggle in the testkit bootstrap
- Regression test: the DB-gated lane completing sign-up end-to-end is itself the regression signal
- Independent retest run: pending (after the F-2 fix lane)
