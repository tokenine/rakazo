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
