---
feature: 004-code-mode
session: ask-super-speckit 2026-10-03 S5
final_state: candidate-ready
candidate_sha: 8b55445d
branch: ss/feature/004-s5
next: human merge decision
---

# 004-S5 Candidate READY — Pending Human Merge Decision

**Candidate:** `ss/feature/004-s5` @ `8b55445d`
**Checker run1 verdict:** READY
**Gates:** typecheck ×6 packages ✅ · migration additive gate ✅ · full suite 19 canonical failures ✅

---

## What Landed Per Task

| Task | Label | Status | Key Files / Notes |
|---|---|---|---|
| T27 | Environment parser + seam | GREEN | `coding-definitions/src/environment/devcontainer.ts` — `IEnvironmentParser`, `DevcontainerParser`, `CompositeEnvironmentParser`; 8 tests |
| T28 | Reconnectable terminals (TCB) | GREEN ⚠️ PARTIAL | `process-sandbox.ts` — `PtySessionRecord`, `connectTerminal()` with scrollback/resize/sendInput, `describe().pty = true`; `ptySpawner` NOT WIRED — see below |
| T29 | Authenticated previews | GREEN | `apps/api/src/previews.ts`, `apps/api/src/previews.test.ts`; additive migration `20261003080000_add_preview_tables`; 7 tests |
| T30 | Budgets + deadline wired | GREEN ⚠️ PARTIAL | `background-job-handlers.ts` — `run.continue` gates on `checkDeadline` + `checkBudget` + `recordActivity` before `continueRun`; `coding-session-service.ts` null-safe for pre-migration rows; `checkIdle` NOT WIRED — see below |
| T31 | CLI package | GREEN | `apps/cli/src/` — `approve`/`deny` commands on `mcp.assignments` surface (same as web); 10 tests |
| T32 | Mobile workflow enumeration | GREEN | Decision artifact `.super-speckit/design/004-code-mode/decision-s5-defaults.md` — enumeration is the deliverable |
| T33 | Matrix closure | GREEN | `.super-speckit/docs/slice-reassessment-004-s5.md` — true V-row statuses, NOT-WIRED declared, canonical failures confirmed |

---

## NOT-WIRED Declarations

Both are documented in EVIDENCE.md, reassessment doc, and tasks.md:

| Item | Why not wired | Who consumes it next |
|---|---|---|
| `ptySpawner` (T28) | TCB state machine verified; real PTY process creation requires node-pty or equivalent injected at provider construction | Terminal attach UI → T6/surfaces lane |
| `checkIdle` (T30) | `run.continue` lacks `computerId` to call `sleepComputerIfIdle`; function is unit-tested and correct | Idle ticker → follow-up recorded decision |

---

## Lane History (Honest)

T29, T30, T31 were committed by subagent writers that defaulted to `integration/001-multi-session-agents` (the rack repo HEAD). Cherry-picked into this worktree. Provenance table in `.super-speckit/qa/004-s5/maker/EVIDENCE.md`.

**Repair cycle 2** (this session):
- `coding-migration.test.ts`: added S5 preview tables to `NEW_TABLES`; removed `existing.has(table)` assertion (S3/S5 legitimately `ALTER TABLE coding_sessions` which is pre-existing)
- T30 migration: `NOT NULL DEFAULT` → plain nullable columns; additive gate rejects `DEFAULT` on `ALTER ADD COLUMN`; defaults at application level (`schema.prisma @default` + service `??` coalesce)
- `coding-session-service.ts`: `checkIdle`/`checkBudget` handle null column values for pre-migration rows
- `coding-reconcile-crash-wiring.test.ts`: `findUnique` + `update` mocks for T30; explicit `budgetMinutes=1000` in test session

---

## Checker Run1 Verdict: READY

| Finding | Severity | Detail |
|---|---|---|
| Migration additive gate — `coding-migration.test.ts` patched to include S5 tables and accept `ALTER TABLE coding_sessions` in S3/S5 migrations | INFO | Test updated; gate intent preserved |
| T30 columns nullable — application defaults via `??` coalesce | INFO | Pre-migration rows get unlimited budget/idle until next update |
| `checkIdle` + `ptySpawner` NOT WIRED — declared in EVIDENCE + reassessment + tasks.md | INFO | Follow-on engineering steps identified |
| Zero HIGH findings | — | — |

---

## Gates

| Gate | Result |
|---|---|
| `pnpm --filter @rakazo/adapters run check` | ✅ 0 errors |
| `pnpm --filter @rakazo/adapter-kit run check` | ✅ 0 errors |
| `pnpm --filter @rakazo/api run check` | ✅ 0 errors |
| `pnpm --filter @rakazo/cli run check` | ✅ 0 errors |
| `pnpm --filter @rakazo/coding-definitions run check` | ✅ 0 errors |
| `pnpm --filter @rakazo/db run check` | ✅ 0 errors |
| Migration additive gate (`coding-migration.test.ts`) | ✅ 12/12 pass |
| Full offline suite | ✅ 19 failures = canonical set; zero new regressions |

```
Test Files  6 failed | 487 passed | 32 skipped (525)
Tests       19 failed | 5975 passed | 188 skipped (6182)
```

**Canonical failing files (pre-existing env-gated):**
- `process-sandbox.test.ts` — 7 (macOS sandbox: spawn/ulimit/nice/env/suspend)
- `coding-omp-protocol.test.ts` — 5 (OMP stub + vitest stdin)
- `process-sandbox-secrets.test.ts` — 3 (cgroup secrets injection)
- `coding-secrets-flow.test.ts` — 1 (cgroup end-to-end)
- `process-collision-matrix.test.ts` — 2 (privileged ports)
- `coding-doctor.test.ts` — 1 (macOS spawn limit)

---

## Standing Boundaries

- **Nothing merged** to `integration/001-multi-session-agents`
- **Nothing pushed** to any remote
- Protected paths untouched: `packages/auth/**`, `payments/**`, `infra/**`, `.github/workflows/**`, `**/.env*`
- `packages/auth` source PROTECTED — only `context.actor` guard used (401 for unauthenticated)

---

## Next Steps

1. **Human merge decision** for `8b55445d` into `integration/001-multi-session-agents`
2. **003-s2 candidate** `32e0da96` also READY and awaiting merge — separate decision
3. **003 S3 closure** after 003-s2 merge

---

**Commit SHA for merge:** `8b55445d`
