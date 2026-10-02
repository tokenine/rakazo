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

## Phase 2: Convergence

Note: this feature has no plan.md (spec + tasks + grill served as intent; recorded deviation).
Converged on function (2026-10-02): catalog, RPC, routes, HubPage zones, make-similar, e2e
(3/3 at QA candidate 697a638f, ancestor of HEAD) all implemented. Findings are constitution
token violations (a later merge regressed the Welcome cleanup and the tdd-log's "0 hex
matches" claim is inaccurate on the current tree) plus test-completeness gaps. Recorded
without tasks: tasks.md T5 says `experts.create` but code/contracts use
`bots.createFromExpert` (implementation matches spec R3 intent; stale task wording, not
rewritten per append-only contract).

- [x] T11 Reapply semantic-token cleanup to Welcome.tsx: hex gradient #FB923C/#F97316/#EF4444,
      text-white, shadow-orange-500/30, hardcoded rgba shadows — the 247e77e9 cleanup was
      wiped by the 3406a70d sign-in merge per R4/V3 (contradicts)
- [x] T12 Replace HubPage.tsx hardcoded `#6B7280` bot-color fallback with a semantic token,
      and make the V3 grep gate repeatable (script/CI step) — tdd-log's recorded "0 matches"
      is inaccurate on the current tree per R4/V3/T9 (contradicts)
- [x] T13 Add filesystem assertion that every catalog visualAssetPath exists under
      packages/contracts/assets/inspiration/ (today only the .svg suffix is regex-checked)
      per V5/T7 (partial)
- [x] T14 Fix catalog copy: case notion-knowledge title "จัด知识库" mixes Chinese into
      Thai-first copy per R4 (contradicts)
- [x] T15 Decide and record: fully-empty /app redirects to /onboarding (QA-blessed) instead of
      the literal "render HubPage when space empty" task text — accept onboarding as the
      guided path or render HubPage per T3/R2 (partial)
- [x] T16 Derive the Shell fallback Personal space's hasContent from bots/groups instead of
      hardcoding true, so first-actions cannot be silently hidden if the API returns zero
      spaces per R2 (partial)
- [x] T17 Add an RPC-level test for inspiration.list payload/schema per T2 (missing)
- [x] T18 Stabilize hub.spec.ts make-similar test: replace page.evaluate JS click +
      fixed 300ms timeout with proper locator/wait per T8 (partial)
