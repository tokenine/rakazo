# Tasks — 002 Inspiration hub

Spec: specs/002-inspiration-hub/spec.md · Matrix: specs/002-inspiration-hub/verification-matrix.md ·
Grill: .super-speckit/grills/002-inspiration-hub/spec-grill.md · Design: .super-speckit/design/002-inspiration-hub/decision.json (decided)

Red-green per repo/resolve seams; e2e last. Single slice (route: normal).

## Slice 1 — hub + catalog + make-similar

- [ ] T1 (P1) Catalog: packages/contracts/src/inspiration-catalog.ts — INSPIRATION_CATALOG (5-8 cases; key, title, one-line description, expertKey ∈ EXPERT_CATALOG, visual asset path, tags) + CATALOG_VERSION constant + zod schema; visual assets bundled (grayscale-friendly SVG/webp in packages/contracts/assets/inspiration/)
- [ ] T2 (P1) RPC: inspiration.list → z.array(InspirationCaseSchema) (contracts rpc.ts + one-line router pass-through)
- [ ] T3 (P1) Route: /app/hub renders HubPage in ShellPage chrome; /app with no botId renders HubPage when space.hasContent === false (App.tsx + Shell.tsx wiring)
- [ ] T4 (P1) HubPage zones per design decision: greeting header · Activity (runs/list recent + SpaceNavigation previews) · Gallery rail (cards: visual/title/[Make similar]) · First-actions (create agent → experts catalog; connect model → integrations; connect Telegram → integrations) — semantic tokens only, copy budget enforced
- [ ] T5 (P1) Make similar: experts.create({expertKey, name}) → navigate /app/:botId/:primaryThreadId
- [ ] T6 (P2) Welcome.tsx constitution cleanup: hardcoded hex gradients → semantic tokens
- [ ] T7 (P1) Unit: catalog schema + expertKey resolution + asset paths exist (V5)
- [ ] T8 (P1) E2E sessions-style spec: V1 (empty → guided; active → recent) + V2 (make similar creates + navigates)
- [ ] T9 (P2) V3 grep gate: zero hardcoded hex in apps/web hub/Welcome files; screenshots for the report
- [ ] T10 (P2) V4 degradation note text (for the QA report)

## Out of scope (recorded)

- Mobile hub/gallery (V4 degradation) · remote catalog refresh · points/credits · connector auto-authorization · modelless guard (known v1 behavior)
