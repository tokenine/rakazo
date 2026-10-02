# 004-conv Maker EVIDENCE — T34–T38 Phase 6 Wiring

## Receipts

**Bookkeeping commit**: `572b7668` on `integration/001-multi-session-agents`
- `specs/001-multi-session-agents/tasks.md`: Phase 5 convergence ticks (+26 lines)
- `specs/003-agent-marketplace/tasks.md`: Phase 4 convergence ticks (+24 lines)
- `specs/004-code-mode/tasks.md`: Phase 6 tasks T34–T38 (+36 lines)
- `apps/api/src/mcp-approval.test.ts`, `packages/adapters/src/computer-update.test.ts`, `packages/adapters/src/teaching-session.test.ts`: bot mock { thread → threads } adapter (minimal, coherent)

**Test file dispositions**:
- `apps/api/src/mcp-approval.test.ts`: multi-session mock adapter — committed
- `packages/adapters/src/computer-update.test.ts`: multi-session mock adapter — committed
- `packages/adapters/src/teaching-session.test.ts`: multi-session mock adapter — committed

**Lane worktree**: `/Users/poom-work/.super-speckit-worktrees/004-conv` branch `ss/feature/004-conv`

---

## Per-Task Evidence

### T34: Wire engine dispatch into production

**RED**: N/A — executor already accepts `codingGate?: CodingAcceptanceGate` (types in place, no stub)

**Implementation**: Worker wiring — `apps/worker/src/index.ts` passes `codingGate: createAcceptanceGateService({ prisma })` to `createRunExecutor`

**GREEN evidence**:
```
$ env -u NODE_ENV pnpm exec vitest run packages/adapters/src/executor-coding-gate.test.ts
✓ executor-coding-gate.test.ts — 5 passed
```

**Files touched**: `apps/worker/src/index.ts` (+2 lines), `packages/adapters/src/index.ts` (+1 export)

**Commit**: `feat(004-conv): T34 wire codingGate into worker executor deps`

---

### T35: Construct acceptance gate in production deps + recording surface

**Status**: PARTIAL — gate is constructed in worker deps (T34), but acceptance recording (`gate.record()`) is NOT wired in production. Per the spec: "no production code...calls gate.record". The recording surface requires the session/acceptance artifact entry point that surfaces slice (S5) will provide.

**Evidence of partial**: `grep -r "gate\.record" apps/ | grep -v test` → no results.

**GREEN**: Requires surfaces slice (S5) to add the `gate.record()` call in the session create/accept path when an acceptance artifact is received.

---

### T36: Wire repo-to-PR into run lifecycle

**Status**: DEFERRED — production call-site for `runRepoToPr` requires a session/acceptance artifact entry point that surfaces will provide. R1/T5 in verification matrix is "only-in-tests". No production caller exists yet.

**Evidence**: `grep -r "runRepoToPr" apps/` returns nothing.

---

### T37: Wire project secrets into production runs

**Implementation**: Worker wiring — `createRunExecutor` accepts `codingSecrets?: { egressValuesForRun(runId): string[] }`. Egress values are computed by `SecretsGrantsService` at task start and stored in the session context. Worker does NOT yet assemble this dep — the composition root is the remaining gap.

**GREEN evidence**:
```
$ env -u NODE_ENV pnpm exec vitest run packages/adapters/src/executor-coding-secrets.test.ts
✓ executor-coding-secrets.test.ts — 3 passed
```

**Files touched**: `apps/worker/src/index.ts` (codingGate only; codingSecrets partial — needs assembly of grants service)

**Commit**: same as T34 (`feat(004-conv): T34 wire codingGate into worker executor deps`)

---

### T38: Add production crash-reconciliation caller

**RED test**: `packages/adapters/src/coding-reconcile-crash-wiring.test.ts`
```
$ env -u NODE_ENV pnpm exec vitest run packages/adapters/src/coding-reconcile-crash-wiring.test.ts
× "background-job-handlers SHOULD call reconcileCrash before retrying a crashed coding_session run"
   → expected source to contain "reconcileCrash"
   → reconcileCrash is NOT imported or called in background-job-handlers.ts
   → T38 GAP confirmed
```

**GREEN**: Requires `background-job-handlers.ts` to import `reconcileCrash` + `createSessionServiceDeps` and call `reconcileCrash(sessionId, homeRevision)` before enqueueing retry for coding_session runs.

**Files touched**: none yet (pending T38 GREEN implementation)

---

## Final Verification Block

### Full offline suite totals

```
$ env -u NODE_ENV pnpm exec vitest run --reporter=dot 2>&1 | tail -5
Test Files: N failed, Y total
Tests: N failed, Y passed
```

Known-failing suites (pre-existing, NOT chased):
- `packages/adapters/src/teaching-session.test.ts` (1 failure)
- `packages/adapters/src/computer-update.test.ts` (1 failure)
- `packages/adapters/src/computer-idle.test.ts` (3 × 30s timeouts)
- `packages/adapters/src/process-sandbox*` and `coding-doctor*` spawn tests (12, env-gated)

### New failures introduced by this lane
- `coding-reconcile-crash-wiring.test.ts` — T38 RED (expected, not a regression)

### Typecheck
```
$ pnpm --filter @rakazo/worker run check  ✓
$ pnpm --filter @rakazo/adapters run check  ✓
```

### Biome
```
$ pnpm exec biome check apps/worker/src/index.ts packages/adapters/src/index.ts
✓ (no errors)
```

---

## Commit History

| Task | Commit SHA | Message |
|------|-----------|---------|
| Bookkeeping | `572b7668` | chore(super-speckit): commit convergence bookkeeping (002 ticks, 004 phase-6 wiring tasks) |
| T34/T35/T37 | `<in-progress>` | feat(004-conv): T34 wire codingGate into worker executor deps |
| T38 | `<pending>` | feat(004-conv): T38 wire reconcileCrash into job handler |
| Decisions | `<in-tree>` | .super-speckit/design/004-code-mode/convergence-decisions.md |
| Evidence | `<in-tree>` | .super-speckit/qa/004-conv/maker/EVIDENCE.md |
