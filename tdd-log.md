# TDD Log — 003-agent-marketplace Slice S2

## Slice S2 (T6–T10): catalog seam + marketplace UI

| Task | RED | GREEN | Files | Commit |
|------|-----|-------|-------|--------|
| T6 | `marketplace-catalog.test.ts` — 0 tests (module not found) | 11/11 `marketplace-catalog.test.ts` | `packages/contracts/src/marketplace-catalog.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/rpc.ts`, `apps/api/src/marketplace-catalog.test.ts`, `apps/api/src/router.ts` | `feat(003-s2): T6 catalog seam — CatalogSource interface, bundled/operator providers, marketplace.list RPC` |
| T7 | `MarketplacePage.tsx` not created; `/app/marketplace` route missing | V3 token gate 3/3; `pnpm --filter web check` clean | `apps/web/src/pages/MarketplacePage.tsx`, `apps/web/src/App.tsx`, `apps/web/src/pages/Shell.tsx`, `apps/web/src/pages/design-tokens.test.ts` | `feat(003-s2): T7 marketplace page — /app/marketplace route, ShellPage marketplaceEntry, 3 hijack guards, card grid UI` |
| T8 | `MarketplacePage.tsx` — no drawer, no import modal | V3 token gate 3/3; `pnpm --filter web check` clean; biome 0 | `apps/web/src/pages/MarketplacePage.tsx` (DetailDrawer + ImportReviewModal) | `feat(003-s2): T8 detail drawer + import review modal — two-phase previewImport→confirm flow, secretFlaggedFields verbatim` |




## 2026-10-12 — resource slice A: hermetic pty-wiring test roots

- Red: added an afterAll guard to `packages/adapters/src/process-pty-wiring.test.ts`
  asserting no `process-pty-wiring-*` remains in the working directory. Run with the
  original relative `root` → 1 file failed, 12 tests passed, 12 directories leaked.
- Green: suite uses one `mkdtemp` root under `os.tmpdir()` removed at teardown.
  Rerun → 12 passed, 0 directories in CWD. All 12 behavior tests (scrollback,
  reconnect, view-only demotion, spawn contract) unchanged and green.
- Guardrail: `process-pty-wiring-*` added to `.gitignore`; 135 leaked directories
  removed from the working directory. Production `ProcessSandboxProvider` untouched.

## 2026-10-12 — resource slice B: amortized O(1) scrollback eviction

- Pin: new `packages/adapters/src/scrollback.test.ts` characterizes the eviction
  contract (newest `scrollbackCapacity` lines in order; no eviction below capacity;
  high-volume bound) — 3 passed against the original `push`+`shift` implementation
  before refactoring.
- Refactor: `recordScrollbackLine` compacts in 1,000-line chunks instead of
  `Array.shift` per line (per-line O(buffer) copy at full capacity → amortized O(1),
  memory bounded at capacity + 1,000). Raw array may transiently hold evicted slack,
  so visible reads go through a new `scrollbackWindow` helper; the reconnect replay
  (`terminalSession`) uses it, replaying the same newest-capacity lines as before.
- Green: scrollback, process-pty-wiring, pty-session, node-pty-spawner suites —
  27 passed. No other suites import process-sandbox.

## 2026-10-12 — resource slice C: batched idle-sweep queries

- Red: new test in `coding-idle-sweep.test.ts` — 3 idle sessions must resolve
  with exactly one findMany per table; the batched fake throws if the sweep
  calls per-session `codingSession.findUnique`/`bot.findUnique`. Failed against
  the old per-session loop (1 failed | 6 passed) with "must not fetch sessions
  one by one".
- Green: extracted the pure `isIdleCodingSession` predicate from `checkIdle`
  (single source of truth; `checkIdle` now delegates, all 24 of its tests
  unchanged and green) and rewrote `reconcileIdleCodingSessions` to three
  batched queries (sessions with idle fields, latest-run statuses by id, bot →
  computer by id) — 2N+1 queries per sweep became 3, regardless of session
  count. Existing behavioral assertions (idle suspend, no-computer skip,
  active-run guard, no-activity guard, non-fatal per-session failure) kept,
  with per-session failure now meaning per-computer sleep failure.
- Green: coding-idle-sweep + coding-session-service + job-reconciler — 44 passed.
