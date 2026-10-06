# QA Report — 004-code-mode S6 (T28 PTY wiring + T30 idle suspend), checker run1

Verdict: **READY** (for the slice scope as measured; two informational findings recorded below).

Candidate: `924da3ba45a4ec4c4e74586f68b8a6fd24bccb78` on `ss/qa/004-s6-run1` (worktree `/Users/poom-work/.super-speckit-worktrees/004-s6-run1`). All evidence below was independently reproduced; the maker's numbers were treated as claims. Where a baseline was needed, this worktree was detached at base `0a39f8ac`, the identical suite was run, and the worktree returned to the QA branch before committing artifacts.

## Matrix rows

- **V18 PTY wiring — GREEN at the adapter boundary.** The `SANDBOX_PROVIDER=process` production branch injects a real node-pty spawner (`packages/adapters/src/sandbox-factory.ts:104-107`); node-pty 1.2.0-beta.15 loads only via lazy dynamic import inside `packages/adapters/src/node-pty-spawner.ts:32` (the only other reference is `import type { IPty }`, line 19 — no static import anywhere, verified by grep). connectTerminal captures the handle, streams output lines into the TCB scrollback (re-reading the record per line), wires write/resize/dispose, and deletes the session record when a spawn fails before rethrowing. Proven at runtime on this host with a real bash PTY, including an end-to-end factory-injection echo test.
- **V19 idle suspend — GREEN.** `reconcileIdleCodingSessions` (`packages/adapters/src/job-reconciler.ts:382-408`) enumerates active coding sessions, re-checks each through the existing `checkIdle` (whose own guards reject inactive sessions, active runs, and missing activity — `coding-session-service.ts:666-684`), resolves the computer via `session.botId -> bot.computerId` (same mapping and same `sleepComputerIfIdle(deps, computerId)` shape as the T38 crash path), and skips sessions whose bot has no computer. Per-session failures are logged and non-fatal. It runs in the reconciler's existing `Promise.allSettled` auxiliary block and is wired at both composition roots (`apps/worker/src/index.ts:326-327`, `apps/api/src/app.ts:471-472`). `run.continue` deadline/budget/activity gating is untouched (diff of `background-job-handlers.ts` vs base is empty).

## Gates (actual numbers)

| Gate | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | exit 0; node-pty complete in lockfile importer + packages + snapshots; diff vs base adds exactly node-pty + node-addon-api |
| `corepack pnpm --filter @rakazo/db generate` | exit 0 |
| `corepack pnpm check` | exit 0; verified with forced uncached run: 24/24 tasks, 0 cached |
| 3 new test files | 17/17 pass (wiring 7, real PTY 4 at 344 ms on darwin, idle sweep 6); win32-only skips did not trigger, so the real-PTY runtime row is satisfied locally |
| packages/adapters full suite | exit 1 from pre-existing environmental failures: `19 failed | 2724 passed | 27 skipped (2770)`. Base run at `0a39f8ac` under identical conditions: `19 failed | 2707 passed | 27 skipped (2753)`. **FAIL-set diff base vs candidate: empty — zero new failures.** |
| apps/api suite | exit 0; `611 passed | 1 skipped (612)` |

Note on the maker's counts: they recorded 18 failed / 2 skipped; I measured 19 / 27 at both base and candidate. The one-test delta is the flaky `process-sandbox` T12 settle test (their own flakiness note), and the skip-count delta is invocation-dependent and identical at both commits. The substantive claim — 17 new tests, zero new failures — was proven directly against a base run, not against their self-recorded baseline.

## Claims verification

All six maker claims verified (details with file:line in `findings.json`). Corrections/nuances:

1. Claim 4 counts corrected as above (substance holds).
2. Claim 6b confirmed at base: base `connectTerminal` resolved tasks by raw `computer.id` (base `process-sandbox.ts:366`) while the router passed `toComputerRef` whose id is the DB `providerRef`; for process computers `providerRef` is the workspace dir path (`process-sandbox.ts:503-506`), so DB-derived refs never matched — at base and at candidate. `apps/api/src/router.ts` is not in the diff: S6 neither introduced nor fixed it.
3. New informational finding: T28's production injection is currently **latent** — the only production caller of `connectTerminal` is the router `terminalUrl` handler (`apps/api/src/router.ts:3125-3127`), and it null-gates process computers first via `computerSupportsTerminal`, which admits only docker/e2b/daytona/box/fake (`packages/adapters/src/computer-lifecycle.ts:587-591`, checked at `router.ts:3113`). Even with the declared id-resolution gap fixed, terminalUrl returns `url: null` for process computers today. Exposing V18 to users needs both the kind-gate decision and the id-resolution fix in a later lane.

## Honest limitations

- `ptySessions`/`ptyHandles` are in-memory Maps; session identity does not survive provider restart. Code and the spec update say exactly this; nothing pretends otherwise.
- The failed-spawn test asserts refusal and provider operability but not directly the registry's emptiness; source deletes the record before rethrow (`process-sandbox.ts:421-423`), and the id is never returned to the caller, so the worst case would be a memory-only leak.
- Flaky (pre-existing): `process-sandbox.test.ts` T12 settle test — timing-sensitive on this host; failed in my full-suite runs at both base and candidate.

## Go/no-go

**Go.** All gates pass, the failure sets are proven identical to base by direct measurement, and the two wiring changes are behaviorally tested at their seams. Biggest gap (not a blocker for this slice): the production PTY path has no reachable caller for process computers yet — kind gate plus id resolution must land together in a future slice before V18 delivers user value.
