# TDD Log — 002 Inspiration Hub

## Cycle A (maker lane implementation)

| Step | File | Change | Result |
|------|------|--------|--------|
| T1 RED | `packages/contracts/src/inspiration-catalog.test.ts` | Added tests: schema parse, expertKey resolve, asset path, validate function | Tests failed: file didn't exist yet |
| T1 GREEN | `packages/contracts/src/inspiration-catalog.ts` | Created INSPIRATION_CATALOG (6 cases), CATALOG_VERSION, InspirationCaseSchema, validateInspirationCatalog | 9/9 tests pass |
| T2 RED | `packages/contracts/src/rpc.ts` + `apps/api/src/router.ts` | inspiration.list added to contract + router | TypeScript error: INSPIRATION_CATALOG not imported in router |
| T2 GREEN | `apps/api/src/router.ts` | Added INSPIRATION_CATALOG to contracts imports | Typecheck clean on router.ts |
| T7 unit | `packages/contracts/src/inspiration-catalog.test.ts` | All 9 tests pass (schema validity, expertKey resolution, asset paths, validate function) | ✅ |
| T6 RED | `apps/web/src/pages/Welcome.tsx` | Replaced hardcoded hex gradients + button style with semantic tokens | TypeScript parse error: `->` typo |
| T6 GREEN | `apps/web/src/pages/Welcome.tsx` | Fixed arrow character | File parses clean |
| T9 V3 | `apps/web/src/pages/HubPage.tsx`, `apps/web/src/pages/Welcome.tsx` | grep for hardcoded hex | 0 matches in hub/Welcome files |

## Convergence round (2026-10-02, Phase 2 tasks T11–T18)

| Row | File | Action | Evidence |
|---|---|---|---|
| T12 RED | `apps/web/src/pages/design-tokens.test.ts` (new) | Token gate asserting zero hardcoded colors in HubPage/Welcome | 2 failed — HubPage: `text-white`, `#6B7280`; Welcome: 2×rgba, `text-white`, `shadow-orange-500`, 3 hex — confirming the audit's regression claim |
| T11 GREEN | `apps/web/src/pages/Welcome.tsx` | Button → `bg-primary text-primary-foreground shadow-lg`; rgba drop-shadow arbitrary values → `drop-shadow-xl` | Gate 2/2 pass |
| T12 GREEN | `apps/web/src/pages/HubPage.tsx` | `#6B7280` fallback → conditional `bg-muted text-muted-foreground` token classes, data-driven `bot.color` kept as inline style only when present | Gate 2/2 pass |
| T13 GREEN | `packages/contracts/src/inspiration-catalog.test.ts` | fs assertion: every `visualAssetPath` exists under `packages/contracts/assets/inspiration/` | 10/10 pass (asset-existence row green immediately — existence holds, the test now pins it) |
| T14 | `packages/contracts/src/inspiration-catalog.ts` | `จัด知识库` → `จัดการความรู้` (Thai copy, matches sibling style) | schema tests 10/10 |
| T15 | `.super-speckit/design/002-inspiration-hub/convergence-decisions.md` | Decision recorded: keep onboarding for fully-empty `/app` (reversal path documented) | decision artifact |
| T16 | `apps/web/src/pages/Shell.tsx` | Fallback Personal space `hasContent` derived from bots/groups instead of hardcoded `true` | web typecheck clean |
| T17 GREEN | `apps/api/src/router.test.ts` | RPC test: `/rpc/inspiration/list` returns the bundled catalog over the boundary | 87/87 router tests pass |
| T18 | `apps/web/e2e/hub.spec.ts` | JS-evaluate click + 300ms fixed wait → accessible-name locator with visibility retry | Not run locally (web e2e runs in CI); locator follows repo conventions |
| V3 | gate now repeatable | `design-tokens.test.ts` runs in the web unit suite — the manual grep claim can no longer drift | 2/2 pass |
