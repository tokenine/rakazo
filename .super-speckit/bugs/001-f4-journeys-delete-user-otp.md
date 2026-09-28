# BUG-001-F4 — journeys delete-user test posts password credential deletion for OTP-era users (400 CREDENTIAL_ACCOUNT_NOT_FOUND)

- Status: `confirmed`
- Found in: `001-multi-session-agents / stacked tip ae301f6e / stacked retest` — F-2 residue (test-side only); journeys was previously unreachable past signup due to F-3
- Affected requirement: test infrastructure (journeys suite full-green); no S1 matrix row affected
- Severity: `low` (single test in one DB-gated suite)
- Reproduction: `2/2` (deterministic)

## Expected / actual

Expected: all 37 journeys tests pass on the migrated schema under the OTP signup flow.
Actual: test #11 posts `/api/auth/delete-user` with a password; OTP-era users have no credential account, so better-auth returns `400 CREDENTIAL_ACCOUNT_NOT_FOUND` → 36/37.

## Minimal reproduction

1. On ss/bug/001-f3 tip, run the journeys suite under `VERIFY_DATABASE=1` with real migrated Postgres.
2. Test #11 fails with `400 CREDENTIAL_ACCOUNT_NOT_FOUND`.

## Evidence

- Stacked retest (CheckerS1, independent): report §9 / proof pack; container cleaned
- Sanitization completed: yes

## Fix and regression obligation

- Bug-fix worktree/commit: `ss/bug/001-f4` stacked on `ss/bug/001-f3` — pending; align the delete-user step with the passwordless account model (whatever better-auth exposes for OTP users — e.g. delete via the credential-free path or assert the documented 400 contract if password deletion is intentionally impossible for OTP accounts; choose by reading the server route contract)
- Regression test: journeys 37/37 on the stacked tip under VERIFY_DATABASE=1
- Independent retest run: pending
