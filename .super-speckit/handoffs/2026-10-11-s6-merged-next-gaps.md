# Handoff — 004-code-mode S6 settled, main union + bug sweep delivered (2026-10-11 update)

Date: 2026-10-11 · Branch: `integration/001-multi-session-agents` @ `07007614` · Trigger: maintainer "fix all bug then merge main and all change to our branch with no bug or error"

## Update 2026-10-11 (this revision)

- origin/main (48 commits) merged as `63de6a99`; clean auto-merge, frozen install + prisma + typecheck green on the merged tree.
- BUG-UNION-E2E-01 RETESTED and resolved: the sessions+marketplace+auth-lifecycle slice runs on the integration line again — acceptance 7 passed + 1 flaky pass-on-retry, 0 failures on `07007614` (evidence: `.super-speckit/qa/004-union-retest1/acceptance.md`). The e2e env needs the scripted stack: `AGENT_RUNTIME=scripted CLOUD_AGENT_PROVIDER=emulator EMAIL_EMULATOR=true SANDBOX_PROVIDER=fake WAKEUP_DRIVER=memory MARKETPLACE_IMPORT_SECRET=<dev value>` plus api AND worker (the root `pnpm dev` set; a workerless api strands runs in `queued`).
- The retest surfaced three real product bugs, fixed: `ef9f60c3` (background bot refresh yanked hub/marketplace into a chat), `6178785f` (card Install stacked the review modal on the drawer, trapping the pointer), `492b1cec` (card Install never mounted the review modal). Also `aaee2d0a` account-trigger a11y name + switcher UX.
- BUG-003-S1-06 closed by `a2c2d19d` (bundle endpoints public HTTPS, red-green contracts tests).
- New open low bug: BUG-E2E-02 (`.super-speckit/bugs/send-timeout-under-slice-load.md`) — intermittent send timeouts under slice load; Playwright retries absorb it; probes recorded.

## Original state (2026-10-11 morning)

- S6 (T28 real node-pty spawner + T30 idle-suspend sweep) merged twice: run1 candidate `924da3ba` → `f69e93f6`; run2 re-freeze `2eb3d19d` (verification-matrix markdown only, REQ- IDs added; no code delta vs the checker-verified tree) → `98f1ca01`. Both passes recorded in the feature state `runs[]` with evidence at `.super-speckit/qa/004-s6-run1/`.
- Feature state set to `blocked` (revision 7): no active candidate; the next slice starts a fresh maker lane. The strict schema-2 `record-proof` was deliberately NOT used for this candidate because the configured `playwright` gate was red at `2eb3d19d` (pre-existing breakage below); recording it green would manufacture evidence. The runs entries carry the honest caveat instead.
- `BUG-UNION-E2E-01` registered open: `apps/web/e2e` `completeOnboarding` helper predated the onboarding "Connect a model" step, so signup-driven playwright specs time out on the integration line. Pre-existing to S6 (union merge `1f166822`; S6's diff touches no web files). Fixes merged: `430a00bd` + `a3700758`. Retest pending.

## Verification summary (evidence, not recollection)

- s6-run1 (independent checker, real PTY on darwin): frozen-lockfile install exit 0; typecheck 24/24 uncached; 17/17 new tests; adapters FAIL-set vs directly measured base `0a39f8ac` EMPTY (19 pre-existing environmental failures at both commits); api 611 passed.
- s6-run2: doc-only delta verified by git diff; same gates carried.
- Post-merge bug fixes (`430a00bd`, `a3700758`) are unit-level e2e-helper changes; no product code touched.

## Known gaps / next automatic actions

1. **BUG-UNION-E2E-01 retest** — web playwright slice (sessions + marketplace + auth-lifecycle) green on the merged stack, run by a checker who did not make the fix. This is the release blocker on the integration line.
2. **Latent PTY terminal path (V18 user value)** — `connectTerminal` works at the adapter boundary, but the only production caller (`router.ts` `terminalUrl`) null-gates process computers via `computerSupportsTerminal` (admits only docker/e2b/daytona/box/fake), and the router resolves tasks by raw `computer.id` while the process provider keys sessions by `providerRef` (workspace dir). Kind-gate decision + id-resolution fix must land together in one future slice.
3. **BUG-003-S1-06** (low, unreachable https-loopback endpoint inconsistency) — needs an explicit accept-or-fix decision; blocks nothing.
4. **tasks.md checkbox bookkeeping** — T1–T20 show unticked though slices 1–3 merged with QA evidence; T34–T38 (convergence wiring) are ticked and verified wired in production (`buildEngineRegistry`, `runRepoToPr`, `composeCodingSecrets`, `reconcileCrash` all have production callers). Reconcile the checkboxes against merged evidence during next planning; the QA runs remain the completion authority.

## Limitations

- PTY session registry is in-memory; session identity does not survive provider restart (declared in spec and code).
- ~19 adapters-suite failures are environmental on this macOS host (proven identical at base and candidate); CI remains the authority for those.
- Strict schema-2 proof chain for this milestone remains unused end-to-end repo-wide; legacy `runs[]` entries are the recorded evidence shape for all features.
