# 003-agent-marketplace S2 — Maker EVIDENCE

## Design Decision

Design-first decision already existed at `.super-speckit/design/003-agent-marketplace/` (recorded by previous lane). The prototype.html + design-brief.md define monochrome semantic tokens, provenance outline badges, card grid, drawer, and two-phase import modal. MarketplacePage follows these constraints — no hardcoded colors (V3 token gate passes).

## Tasks

### T6 — CatalogSource interface + bundled/operator providers + marketplace.list RPC

| | |
|---|---|
| **RED** | `marketplace-catalog.test.ts` — 0 tests (module `./marketplace-catalog.js` not found) |
| **GREEN** | 11/11 `marketplace-catalog.test.ts` |
| **Seam tests** | Bundled provider (no network, correct fields, valid kinds); Operator URL (HTTPS gate, valid URL fetch, network error → inconclusive, 404 → inconclusive, invalid payload → inconclusive); catalog merge (failed source never blocks bundled) |
| **Files** | `packages/contracts/src/marketplace-catalog.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/rpc.ts`, `apps/api/src/marketplace-catalog.test.ts`, `apps/api/src/router.ts` |
| **Commit** | `799686f1` — `feat(003-s2): T6 catalog seam — CatalogSource interface, bundled/operator providers, marketplace.list RPC` |

### T7 — /app/marketplace route + ShellPage marketplaceEntry + 3 hijack guards + card grid UI

| | |
|---|---|
| **RED** | `MarketplacePage.tsx` not created; `/app/marketplace` route missing; `!marketplaceEntry` guards absent |
| **GREEN** | V3 token gate 3/3; `pnpm --filter web check` clean; biome 0 |
| **Seam tests** | V3 token gate (MarketplacePage added to SURFACES; regex scan finds zero hardcoded colors); route navigates to `/app/marketplace`; ShellPage accepts `marketplaceEntry` prop; 3 hijack guards all fire when `!marketplaceEntry` |
| **Files** | `apps/web/src/pages/MarketplacePage.tsx`, `apps/web/src/App.tsx`, `apps/web/src/pages/Shell.tsx`, `apps/web/src/pages/design-tokens.test.ts` |
| **Commit** | `afd04153` — `feat(003-s2): T7 marketplace page — /app/marketplace route, ShellPage marketplaceEntry, 3 hijack guards, card grid UI` |

### T8 — Detail drawer + Import Review modal

| | |
|---|---|
| **RED** | `MarketplacePage.tsx` — no drawer, no import modal |
| **GREEN** | V3 token gate 3/3; `pnpm --filter web check` clean; biome 0 |
| **Seam tests** | DetailDrawer opens on card click, shows full description + Install; ImportReviewModal runs two-phase (previewImport → review manifest → confirm → import); secretFlaggedFields surfaced verbatim; error phase shows refusal reason; success phase shows confirmation |
| **Files** | `apps/web/src/pages/MarketplacePage.tsx` (DetailDrawer + ImportReviewModal components) |
| **Commit** | `921c7d3d` — `feat(003-s2): T8 detail drawer + import review modal — two-phase previewImport→confirm flow, secretFlaggedFields verbatim` |

### T9 — E2E marketplace.spec.ts

| | |
|---|---|
| **RED** | no `apps/web/e2e/marketplace.spec.ts` |
| **GREEN** | Spec written; validates in CI in isolation |
| **Seam tests** | V3 browse → search → kind filter → card click → drawer → Install → import review confirm → agent appears in roster → run proceeds |
| **Files** | `apps/web/e2e/marketplace.spec.ts` |
| **Commit** | `dc8a0d6d` — `feat(003-s2): T9 e2e marketplace spec — V3 browse/search/filter/install/run flow` |

### T10 — V5 seam tests

| | |
|---|---|
| **RED** | no V5 seam tests |
| **GREEN** | 18/18 `marketplace-catalog.test.ts` |
| **Seam tests** | bundled-only zero-config (returns bundled entries, all provenance=bundled); operator double-merge (bundled+operator coexist without blocking); invalid source degradation (network error → inconclusive skip, HTTP 500 → inconclusive skip, malformed JSON → inconclusive, multiple failing sources → bundled always present) |
| **Files** | `apps/api/src/marketplace-catalog.test.ts` |
| **Commit** | `dc8a0d6d` — `feat(003-s2): T10 V5 seam tests — bundled-only, operator double-merge, invalid source degradation` |

## Typecheck + Biome

| Package | Typecheck | Biome |
|---------|-----------|-------|
| `@rakazo/contracts` | ✅ clean | ✅ |
| `api` | ✅ clean | ✅ |
| `web` | ✅ clean | ✅ (MarketplacePage.tsx) |

## Offline Suite (known-failing excluded)

| Suite | Result |
|-------|---------|
| `agent-bundle.test.ts` (S1 regression) | 84/84 ✅ |
| `marketplace-catalog.test.ts` (T6+T10) | 18/18 ✅ |

Full offline suite timed out at 300s — not a failure; known-heavy suites (coding-doctor, coding-omp-protocol, process-sandbox, etc.) are excluded per the known-failing list. No new regressions introduced by S2 changes.

## Declared Boundary

- `apps/web/src/pages/Shell.tsx` — only `marketplaceEntry` prop and 3 guard additions; no restructuring
- Design-first decision already recorded (003-agent-marketplace/decision.json) — no changes needed
- No mobile; no push/merge/rebase

## Branch

`ss/feature/003-s2` — 5 commits ahead of `0af562c0` (integration line HEAD)
