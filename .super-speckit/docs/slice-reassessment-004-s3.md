# 004-code-mode — Slice 3 reassessment (secrets subsystem, Q10 Option B)

## What was verified

- Scope: Slice 3, T14–T21 against `plan.md` S3, matrix rows V8/V9/V10/V11, and
  `.super-speckit/design/004-code-mode/decision.json` Q10 Option B (per-task
  least-privilege grants, hash-chained JSONL audit + `audit verify`, deny-list egress
  filter, spawn/bootstrap-env-only injection, TTL + revoke). S2 TRACKING LOW-7 folded as
  the binding constraint (request.env can never re-inject grant-gated secrets).
- Maker lane `rakazo-004-s3-maker-r1` on `tl/004-purpose-gate-r1`; implementation tip
  `ec81b0a5`; evidence commits follow. `apps/web` untouched (S3 is API/worker/adapter).
- Checker `rakazo-004-s3-ck1` verdict READY-WITH-FIXES (2 MED + 4 LOW, no HIGH; no bypass
  constructed on the binding constraint). Fix rounds r1 (coding-migration registry, biome)
  and r2 (all 6 findings: MED-1 literal redaction coverage via runSecrets, MED-2
  isAdditiveColumnAdd gate tightened for DEFAULT/COLLATE/GENERATED/IDENTITY, LOW-3/4/5/6)
  all folded with red-first evidence under `.super-speckit/qa/004-s3/`.
- TL retest round 3 FINAL green: 4849 passed / 28 pre-existing / 171 skipped; state →
  `candidate_ready` at candidate SHA `7b217b57`. Full evidence:
  `.super-speckit/qa/004-s3/EVIDENCE.md`, `green/`, `red/`, `tl-retest/`.

## Post-merge integration verification (integration line)

- `tl/004-purpose-gate-r1` merged into `integration/001-multi-session-agents`
  (merge commit `a742aeea`), together with the Dome mainline union (`1f166822`) and the
  003-complete sync (`36c3f2d1`). Full workspace `tsc --noEmit` (turbo check) green across
  23 packages.
- Offline suites on the merged tree: apps/api 582 passed / 1 skipped; packages/db +
  contracts + core 960 passed / 13 skipped; touched adapter suites (executor,
  computer-update, computer-lifecycle, teaching-session, coding-project-secrets) 205/205.
- The 12 failing `process-sandbox*`/`coding-doctor` spawn tests fail identically at the
  pre-merge 004 tip (`f48a8d38`) on this macOS host — pre-existing, environment-gated
  ("passes on the team box"), not introduced by the merge.
- Merge resolution of record: mainline loosened the shared `BotSecretName` regex to allow
  hyphens (display-only bot secrets). 004's ratified v1 grammar (EVIDENCE.md constant 2:
  `^[a-z][a-z0-9_]{0,63}$`, names become process-env identifiers) is preserved as a
  strict subset inside `isValidProjectSecretName` (`coding-project-secrets.ts`), so
  V9's "no wildcards, no dashes" pin holds while the mainline's looser display grammar
  stands for bot secrets. Regression tests unchanged and green.

## Decision

**keep** — continue the milestone route. Next: Slice 4 (Continuity + OMP engine,
T22–T26; V1(omp)/V2(omp)/V6/V15), OMP RPC experiment (T24) precedes any adapter work (T25).
