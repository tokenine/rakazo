---
feature: 004-code-mode
session: ask-super-speckit 2026-10-02 Phase-6 convergence
final_state: candidate-ready
candidate_sha: 34e188e5
branch: ss/feature/004-conv
next: human merge decision, then S5 gated on Q6/Q7/Q8
---

# 004-conv Stage Handoff — Candidate READY

## What Landed

### T34 — Engine registry into worker composition
`buildEngineRegistry` assembled in `apps/worker/src/index.ts`; `registry` passed to `createBackgroundJobHandlers`; engine-keyed session-op dispatch wired; OMP unreachable-until-selected (no silent switch) per R2/T2.

### T35 — codingAcceptance RPC routes + gate.record surface
`createAcceptanceGateService` wired in API `router.ts`; `codingAcceptance: { record, get }` RPC routes; gate stays fail-closed until acceptance recorded.

### T36 — run.completed → runRepoToPr
`run.completed` handler in `background-job-handlers.ts` now calls real `runRepoToPr` with:
- `prisma`, `secretStore`, `diff` (workspace diff), `artifacts`, `commandRunner`, `forge` (optional)
- Workspace directory resolved via `resolveAgentHomePath(home, bot.computer.homeKey, dataDir)`
- `implement` is a no-op (run already completed; diff captured pre-completion)
- Errors logged, never re-thrown (background-job contract)
- **Boundary declared**: `ForgeClient` (GitHub OAuth credentials) lives in surfaces/CLI; handler logs warn and skips when `forge` is absent; surfaces layer (T31 CLI) must construct and pass `ForgeClient` to `createBackgroundJobHandlers` for end-to-end PR creation.

Also: real `inspectChanges` via `home.changesSince` in the registry machinery.

### T37 — composeCodingSecrets wired into worker executor deps
`composeCodingSecrets(codingSecretsCache)` assembled; `codingSecretsCache = new Map<string, string[]>()` created in worker; passed to `createRunExecutor`; surfaces layer contract documented: pre-resolve via `resolveGrantedSecrets` → `Object.values(result.env)` stored keyed by runId → executor reads sync.

### T38 — reconcileCrash before retry
`reconcileCrash` called in `run.continue` handler before `executor.continueRun` for `coding_session` crashed runs; session+homeRevision sourced from `bot.computer`; non-fatal try/catch.

---

## Lane History (Honest)

| Round | Who | What |
|-------|-----|------|
| Rounds 1–3 | Maker | R1: stubs; R2: helpers tested in isolation; R3: helpers + RED tests passed but **compositions stayed stubbed** — checker caught the gap. |
| Checker run1 | checker-004-conv-run1 | Found T36/T37 still stubbed despite passing test counts. |
| Orchestrator fold (a10227dd/93adf716/133af3d6) | fold-004-conv | Wired real `composeCodingSecrets` into worker; wired real `runRepoToPr` into `run.completed`; lint fixes. |
| Typecheck fix (a15867c7) | fold-004-conv | 3 errors caught by retest: duplicate `dataDir` field, wrong `resolveAgentHomePath` call (free function not method), missing `runRepoToPr` import. Plus bonus: missing `composeCodingSecrets` export in index.ts. |
| Checker run2 | checker-004-conv-run1 | Found 3 typecheck errors vitest doesn't catch. |
| Fix + READY (34e188e5) | fold-004-conv | All typecheck errors fixed; biome clean; 19 failures = known set; A/B clean. |

Evidence: `.super-speckit/qa/004-conv/maker/EVIDENCE.md`, `.super-speckit/qa/004-conv-run2/findings.json`.

---

## Verification

| Check | Result |
|-------|--------|
| `pnpm --filter @rakazo/adapters run check` | 0 errors |
| `pnpm --filter @rakazo/worker run check` | 0 errors |
| `pnpm --filter @rakazo/api run check` | 0 errors |
| `pnpm exec biome check` (touched files) | 0 errors |
| Full offline suite | 6 failed | 484 passed | 32 skipped |
| Tests | 19 failed | 5948 passed | 188 skipped |

**19 failures = exactly the known env-gated set** (macOS host lacks cgroup namespace + privileged port binding + OMP adapter stub):

| File | Count | Reason |
|------|-------|--------|
| `coding-doctor.test.ts` | 1 | macOS spawn limits ("passes on the team box") |
| `coding-omp-protocol.test.ts` | 5 | OMP adapter stub — truthful V1(omp)/V2(omp) state |
| `coding-secrets-flow.test.ts` | 1 | cgroup grant channel unavailable on macOS |
| `process-collision-matrix.test.ts` | 2 | privileged port binding unavailable on macOS |
| `process-sandbox-secrets.test.ts` | 3 | cgroup namespace unavailable on macOS |
| `process-sandbox.test.ts` | 7 | macOS sandbox (cgroup + process isolation) |

**A/B baseline at 572b7668** vs lane head 34e188e5: baseline 19 failures = lane 19 failures; 0 new failures introduced. Lane has 4 more passing tests than baseline (new RED fixtures in executor-coding-secrets-assembly and coding-reconcile-crash-wiring).

---

## Declared Boundaries (Not Bugs)

1. **ForgeClient / GitHub OAuth** (`packages/adapters/src/coding-repo-to-pr.ts` — `ForgeClient` interface):
   `run.completed` guards on `deps.forge` presence and skips the PR step when absent, logging a warn. GitHub OAuth credentials live in the surfaces/CLI layer (T31 CLI owns the OAuth flow). Worker has no ForgeClient. The data path (diff + verification records → session row) is complete; the PR creation step waits for surfaces layer to wire ForgeClient.

2. **OMP spawn + tool approval** (`apps/worker/src/index.ts` — `registry`):
   `spawnOmp` and `approveTool` in the registry machinery throw in the worker composition. This is the truthful V1(omp)/V2(omp) state per the S4 OMP RPC probe: all six coding ops (`prompt`, `steer`, `stop`, `resume`, `inspectChanges`, `getApprovals`) return `UnsupportedEngineOperationError`. The 5 `coding-omp-protocol.test.ts` failures pin this same surface. Surfaces must provide real factories before OMP can run in production.

3. **coding-omp-protocol 5 failures**: Pin the unsupported OMP surface. Not regressions — they failed before this lane too.

---

## Standing Boundaries

- `merge_requires_human: true` in `super-speckit.yml` — no auto-merge.
- Nothing pushed; lane branch (`ss/feature/004-conv`) and QA branches are local only.
- Dome integration line (`integration/001-multi-session-agents`) is the merge target.

---

## Next

1. **Human merge decision** for candidate `34e188e5` into `integration/001-multi-session-agents`. Lane branch: `ss/feature/004-conv`. A/B baseline at `572b7668` confirms 0 new failures.

2. **S5 opens only after** the user answers:
   - **Q6**: Budgets/idle defaults (idle threshold, budget units, deadlines) — presented to user at slice review before hardcoding (per tasks.md T30).
   - **Q7**: Setup definition format — devcontainer.json vs custom; reproducible replace + truthful needs-restart report.
   - **Q8**: Mobile workflow enumeration — fixed list before mobile work.
   See handoff `004-S4-merged-S5-ready.md` §7/§10.

3. **003-agent-marketplace S2** next per the user's queue after S5 opens.
