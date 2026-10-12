# Evidence-labeled Spec Grill — 002-inspiration-hub

Purpose map: .super-speckit/purpose/002-inspiration-hub/purpose-map.md (diagram-first, human-confirmed)
Human confirmation: .super-speckit/purpose/002-inspiration-hub/decision.json
Runs: GrillBuilder2 / GrillExaminer2 / GrillInvestigator2 (independent scouts); Resolver integrated.

## Builder

Smallest coherent shape: `/app/hub` route rendered inside ShellPage chrome (sidebar + topbar stay); HubPage shown as main content when no botId is active; gallery = new pure-data catalog file following the EXPERT_CATALOG pattern (`packages/contracts/src/`); one new RPC `inspiration.list` (pass-through of the catalog); Make-similar reuses `experts.create` (expertKey → bot + primary thread), client navigates to `/app/:botId/:threadId`; empty gate = `hasContent === false` from spaces/list; activity zone = `runs/list(recent)` + per-bot previews from SpaceNavigation; mobile = recorded degradation (no hub in v1).

## Examiner

10 challenges (path:line evidence in grill run transcript):
1. No /hub route exists; authenticated "/" → /app → ShellPage unconditionally (blocker).
2. First-sign-in/empty trigger undefined — routing checks auth only, never `hasContent` (blocker).
3. "Empty" ambiguous incl. archived bots (hasContent includes archived) (major).
4. No deployment-status RPC for the client (major).
5. No inspiration catalog separate from EXPERT_CATALOG; different card anatomy (visual→title→Make similar vs avatar+tags+description) (major).
6. EXPERT_CATALOG has no version marker; A3 requires versioned catalog (minor).
7. case→expertKey mapping absent (major).
8. modelProvider nullable — Make-similar with no configured model may create a non-functional bot (major).
9. Connectors pre-wired but unauthorized post-create (minor).
10. Welcome.tsx hardcoded hex gradients violate R4 constitution (major); "every visible word justified" has no enforcement mechanism (minor).

## Investigator

All six probes proven: (1) catalog precedent = EXPERT_CATALOG + EXPERT_AVATARS pure-TS arrays in packages/contracts/src/experts.ts:1-377 + assets/avatars/*.svg; (2) AutoClaw screenshots NOT in repo — design-first proceeds from spec + confirmed purpose-map diagrams; (3) routing ownership: App.tsx:55/72/101, Shell.tsx (6,521 lines, no hub); (4) empty = `hasContent === false` (router.ts:5162-5176 spacesWithContent: no bots AND no groups, archived included); (5) mobile: Home (index.tsx, 1,169 lines) already has activity mode (runs/list polling 15s) but no gallery — options: extend Home when hasContent=false / new /hub route / recorded degradation; (6) activity RPCs: runs/list(recent) (rpc.ts:851), per-bot previews from spaces/list → spaceNavigationDto (router.ts:5132), experts.create mechanics via findExpert + EXPERT_AVATARS + EXPERT_SKILLS (experts.ts:363, domain.ts:345-350).

## Resolver

| Question | Resolution | Classification | Evidence / rationale | Verification consequence |
| --- | --- | --- | --- | --- |
| Hub route | `/app/hub` route + HubPage as ShellPage main content when /app has no botId; "/" redirect unchanged | assumed (route over conditional render: deep-linkable, e2e-able; reversible) | Examiner #1/#2; Builder proposal; App.tsx:55-107 proven | V1 e2e: /app/hub renders; empty user landing on /app sees hub |
| Empty trigger | Hub guided view when space.hasContent === false; active view otherwise | proven mechanics + decided | router.ts:5162-5176 authoritative | V1: empty deployment → guided actions; active → recent threads |
| Archived-only space | Treated as active (out of scope v1) | assumed, reversible | hasContent includes archived (domain.ts:253) | documented in QA note |
| Deployment-status RPC | None — client uses spaces/list hasContent + SpaceNavigation bots | assumed (reversible: dedicated RPC if hub grows) | Examiner #4; data already client-side | none |
| Gallery catalog | New `INSPIRATION_CATALOG` + `CATALOG_VERSION` in packages/contracts/src/inspiration-catalog.ts, ExpertDefinition-referencing cases (visual asset, title, description, expertKey, tags) | decided (proven EXPERT_CATALOG pattern; separate file, separate card anatomy) | Investigator Q1; Examiner #5/#6/#7 resolved together | V2 e2e: case → experts.create → bot+thread |
| Make-similar modelless guard | No pre-create guard in v1 — same behavior as ExpertCreatePanel today; first-run guidance surfaces in thread; revisit when hub learns model state | assumed + reversal path | Examiner #8; router.ts:1033-1056 proven no-guard | QA note row (known v1 behavior) |
| Connectors post-create | Same as ExpertCreatePanel: authorize-later note; no auto-auth | proven current behavior, accepted | expert-create.tsx:126-128 | QA note row |
| Welcome.tsx hardcoded hex | Constitution debt, fix IN this feature (cheap, same surfaces): replace hex gradients with semantic tokens | decided (R4 applies to the feature's surfaces; Welcome is adjacent) | Examiner #10a; Welcome.tsx:43-50 | V3 visual/token check covers it |
| Copy justification enforcement | PR description section listing every visible word + checker visual review; no lint | assumed | Examiner #10b; no precedent proven | V3/QA process row |
| Mobile | Recorded degradation in v1: mobile keeps existing Home (already has activity mode); gallery/hub not shipped; reason recorded per R1 | decided (spec R1 explicitly allows; activity zone partially exists proven) | Investigator Q5; spec R1 | V4 = recorded degradation note |

## Purpose conflicts

None. No discovery alters the confirmed outcome, people, success signal, or non-goals.

## Result

- [x] Ready for design-first and planning
- [ ] Return to Purpose Gate
- [ ] Blocked by external authority or missing evidence
