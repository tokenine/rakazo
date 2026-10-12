---
id: BUG-004-S4-V9
artifact: .super-speckit/bugs/004-S4-V9-regex-regression.md
status: open
severity: high
found_in: b01a75e0
found_by: orchestrator verification of checker claim
regression_test: packages/adapters/src/coding-project-secrets.test.ts:117-120
fix_recipe: .super-speckit/qa/004-s4/maker/EVIDENCE.md (orchestrator fold R2-2)
retest_run: 004-s4-checker
---
# V9 regex regression in `isValidProjectSecretName`

## Summary
The `isValidProjectSecretName` check no longer enforces the 004 v1 strict-subset
grammar. `has-dash` and other names with hyphens are accepted, but V9 requires
"no wildcards, no dashes" (process-env identifier grammar).

## Root cause
Mainline commit `8f6f08be` (Sep 28) loosened the shared `BotSecretName` regex to
`^[a-z][a-z0-9_-]{0,63}$` for display-only bot secrets.

The S3 reassessment of record (`/root/rakazo/repo/.super-speckit/docs/slice-reassessment-004-s3.md`
and `.super-speckit/qa/004-s3/EVIDENCE.md`) made the strict-subset preservation
a **binding constraint**:

> "004's ratified v1 grammar (EVIDENCE.md constant 2: `^[a-z][a-z0-9_]{0,63}$`,
> names become process-process-env identifiers) is preserved as a strict subset
> inside `isValidProjectSecretName` (`coding-project-secrets.ts`), so V9's
> 'no wildcards, no dashes' pin holds while the mainline's looser display grammar
> stands for bot secrets. Regression tests unchanged and green."

The S3 merge (`a742aeea`, Oct 2) brought the loose `BotSecretName` regex into
the integration line but did **not** reapply the strict-subset narrowing in
`isValidProjectSecretName`. The function currently delegates to
`BotSecretName.safeParse(name).success`, which accepts hyphens.

## Failure (verified live)
```
FAIL  packages/adapters/src/coding-project-secrets.test.ts > rejects invalid names,
     including wildcards (v1: no wildcards)
AssertionError: promise resolved "{ id: '1c695b97a4a3ffec8a48a785', …(3) }" instead
of rejecting
  ❯ coding-project-secrets.test.ts:117-18
    - rejects toBeInstanceOf(ProjectSecretNameInvalidError)
  store.set({ workspaceId: "ws-1", name: "has-dash", plaintext: "x" })
```

## Why this is not pre-existing
- V9 is a 004-code-mode matrix row, in-scope for the S4 candidate.
- The S3-reassessed binding constraint on the strict-subset narrowing was lost
  post-merge.
- The checker's finding classified this as "unrelated" — wrong; the failure
  directly contradicts an S3-binding constraint.

## Other observed pre-existing failures (out of S4 scope)
- `coding-engine.test.ts` (none — included in this candidate).
- `teaching-session.test.ts: keeps protected input out of the generated playbook`
  — unrelated, not touched by 004 S4.
- `computer-update.test.ts: resumes a run that bound to a lease released after
  reconciliation` — unrelated, not touched by 004 S4.
- `computer-idle.test.ts: 3 × 30s timeouts` (Linux marker behaviour) —
  unrelated, not touched by 004 S4.

## Fix recipe
Change `isValidProjectSecretName` in `coding-project-secrets.ts` to use the
004 v1 strict-subset regex directly (literal, no delegation):

```ts
const PROJECT_SECRET_NAME = /^[a-z][a-z0-9_]{0,63}$/;
export function isValidProjectSecretName(name: string): boolean {
  return PROJECT_SECRET_NAME.test(name);
}
```

Acceptance:
- `coding-project-secrets.test.ts:117-120` (has-dash rejects) green.
- All other V9 rows (no-wildcards, no-uppercase) still green.
- `BotSecretName` import is removed from this file (no longer needed).
- Checked matrix rows V6/V1(omp)/V2(omp)/V15 unchanged.

## Retest plan
- Targeted vitest: `coding-project-secrets.test.ts` (9 tests).
- Gate: `pnpm --filter @rakazo/adapters run check` — 0 errors.
- Full package test: confirm the 3 unrelated failures persist (NOT a regression
  caused by the fix).
- Confirm `b977f3c9` (post-merge tip before S4) has the same V9 failure → proves
  the regression predates S4 and was hidden by S3's S3-reassess review.