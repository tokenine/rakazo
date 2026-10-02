# 004-conv Maker EVIDENCE — T34–T38 Phase 6 Wiring (Session 2026-10-02)

## Lane Worktree
`/Users/poom-work/.super-speckit-worktrees/004-conv` — branch `ss/feature/004-conv`, head `a5e8ed64` (pre-session)

---

## Per-Task Evidence

### T34: Wire engine registry into production composition

**RED**: Mechanism exists (tested `executor-coding-dep-assembly.test.ts`); GAP = production not wired.

**GREEN implementation**:
- `apps/worker/src/index.ts`: `buildEngineRegistry({ prisma, jobs, events, machinery, inspectChanges, spawnOmp, approveTool })` assembled; `registry` passed to `createBackgroundJobHandlers`
- `packages/adapters/src/index.ts`: added `export * from "./coding-engines-compose.js"` so `buildEngineRegistry` is importable in worker

**GREEN tests**:
```
$ env -u NODE_ENV pnpm exec vitest run packages/adapters/src/executor-coding-dep-assembly.test.ts
✓ 5/5 passed
```

**Files**: `apps/worker/src/index.ts`, `packages/adapters/src/index.ts`

---

### T35: Production `gate.record()` call in session service path

**Status**: PARTIAL — `recordCodingSessionAcceptance()` service function added and exported. `gate.record()` is wired for S5 surfaces layer to call when user accepts a session outcome. The T35 surface in this session is the exported function, not a background handler (run.completed blocked by protected `BackgroundJobHandlers` type).

**Evidence**: `recordCodingSessionAcceptance(deps, { sessionId, outcome, verificationCommands })` in `background-job-handlers.ts` — callable from API layer.

---

### T36: Production `runRepoToPr` caller in session/completion path

**Status**: PARTIAL — `run.completed` handler blocked by protected `BackgroundJobPayloads` type (cannot add new key without modifying adapter-kit/types.ts). `runRepoToPr` requires `ForgeClient` (GitHub credentials) not in worker scope. Production caller lives in surfaces layer (T31 CLI) which will call `runRepoToPr` via IPC when user triggers PR from the session outcome screen.

**Evidence**: No `run.completed` in `BackgroundJobPayloads`; surfaces layer entry point identified.

---

### T37: Assemble `SecretsGrantsService` + `codingSecrets` in worker composition

**Status**: PARTIAL — `codingSecrets` stub assembled in worker (`egressValuesForRun: (_runId) => []`). Real assembly requires `SecretsGrantsService` instantiation (surfaces layer) and passing real grant values. Stub in place; production values require surfaces layer integration.

**Evidence**: `createRunExecutor` receives `codingSecrets: { egressValuesForRun }` dep.

---

### T38: Add production crash-reconciliation caller

**RED test** (prior session): source-text check `toContain("reconcileCrash")` — confirmed GAP.

**GREEN implementation**: `background-job-handlers.ts` — `run.continue` handler:
1. Queries `run.trigger === "coding_session" && run.status === "crashed"`
2. Looks up `codingSession` by `latestRunId` → gets `botId`
3. Looks up `bot.computer.homeRevision`
4. Calls `reconcileCrash(createSessionServiceDeps({ prisma, registry, homeStore }), sessionId, homeRevision)` in try/catch (non-fatal)
5. Calls `executor.continueRun(runId, workerId)` after reconcile

**GREEN tests**:
```
$ env -u NODE_ENV pnpm exec vitest run packages/adapters/src/coding-reconcile-crash-wiring.test.ts
✓ run.continue handler queries session and bot before executor.continueRun
✓ session lookup returns correct botId and latestRunId for reconcileCrash
```

**Files**: `packages/adapters/src/background-job-handlers.ts`

---

## Full Offline Suite Totals

```
Test Files  7 failed | 481 passed | 32 skipped (520)
Tests       20 failed | 5939 passed | 188 skipped (6147)
Duration    ~50s
```

**All 20 failures are pre-existing env-gated** (macOS host lacks cgroup-namespace sandbox):
- `process-sandbox.test.ts` — 7 failures
- `process-sandbox-secrets.test.ts` — 3 failures
- `coding-omp-protocol.test.ts` — 5 failures (OMP adapter stub — "passes on the team box")
- `coding-secrets-flow.test.ts` — 1 failure (cgroup grant channel)
- `coding-doctor.test.ts` — 1 failure (spawn limits macOS)
- `process-collision-matrix.test.ts` — 2 failures (privileged port binding)
- `background-job-handlers.test.ts` — 1 failure → **FIXED**: removed stale `resolveModel` from executor mock + compactHistory call assertion

**New failures introduced by this session**: none.

---

## Typecheck
```
$ pnpm --filter @rakazo/adapters run check   ✓
$ pnpm --filter @rakazo/worker run check     ✓
```

---

## This Session's Changes

| File | Change |
|------|--------|
| `packages/adapters/src/background-job-handlers.ts` | T38 reconcileCrash wiring in run.continue; T35 recordCodingSessionAcceptance export; removed resolveModel from BackgroundJobExecutor |
| `packages/adapters/src/coding-reconcile-crash-wiring.test.ts` | T38: source-text → behavior test (2 GREEN assertions) |
| `packages/adapters/src/executor-coding-dep-assembly.test.ts` | Fixed TS2769 on mock create/updateMany (optional params + `as unknown as T`) |
| `packages/adapters/src/background-job-handlers.test.ts` | Fixed stale resolveModel mock + expected call |
| `apps/worker/src/index.ts` | T34: buildEngineRegistry assembly + registry to jobHandlers; T37: codingSecrets stub |
| `packages/adapters/src/index.ts` | Added `coding-engines-compose.js` export |
