# Evidence-labeled Spec Grill — 003-agent-marketplace

Purpose map: .super-speckit/purpose/003-agent-marketplace/purpose-map.md (diagram-first, human-confirmed)
Runs: GrillBuilder3 / GrillExaminer3 / GrillInvestigator3 (independent scouts); Resolver integrated. Examiner ran security-first per spec R4.

## Builder

Smallest coherent shape: bundle = single versioned JSON (`AgentBundleSchema` in packages/contracts) — bot manifest (portable fields only) + skills[] (AgentSkill portable subset) + mcpServers[] (portable subset) + avatar as bundled avatarKey; export RPC `agents.export`; import = two-phase RPC (`agents.previewImport` → review manifest → `agents.import`); marketplace = `/app/marketplace` route (ShellPage `marketplaceEntry` prop, mirroring the hub pattern incl. the three hijack guards); catalog seam = `CatalogSource` interface (versioned items) with three providers (bundled static / operator URL / hosted future) merged server-side behind one `marketplace.list` RPC; installs write through existing machinery (AgentSkill, McpServer+BotMcpServer, Connection, CapabilityInstall).

## Examiner

15 findings — security-first, several blockers:
1. JSON prototype pollution (no __proto__ stripping before validation) — blocker
2. Asset filename path traversal (blocker)
3. ZIP bomb / no decompression caps (blocker)
4. Schema-version confusion / fallback parsing (major)
5. API-level import bypasses the UI review screen — review must be server-enforced (blocker)
6. `allowAllTools: true` auto-grant replicated from createFromExpert (router.ts:1102) — R4 violated by construction (blocker)
7. Skill content injection into agent context, stored directly (blocker)
8. Export leaks secrets pasted in free-text `instructions` — no containsSecret scan (major)
9. McpServer.headers may carry secrets into bundles (major)
10. Unsigned operator catalogs / MITM (major)
11. Unvalidated catalog URL → 500 leaks (minor)
12. Marketplace search query encoding (minor)
13. Mobile marketplace undefined (major)
14. AgentSkill.source spoofable ('builtin'/'plugin' smuggled) (major)
15. No import bundle size limit (minor)

## Investigator (all proven)

- **Q2 ANSWERED — no new format needed**: `AgentSkill` IS the canonical portable skill (schema.prisma:794-813: name/description/content(SKILL.md)/source; agent-skills.ts:63-70,168-183 parse→validate→build). `TaughtSkill` is runtime state (playbook/recording JSON, bot FK) — NOT portable, excluded from v1 bundles.
- Constitution §7 (.specify/memory/constitution.md:71-76) is a source-security policy; the RUNTIME enforcement point is the existing capability infrastructure: ActionApprovalRule, ActionAutoReviewPreference, CapabilityInstall (schema.prisma:98-118, 831-847).
- No export precedent exists; closest: bots.duplicate (router.ts:1117-1161), createFromExpert (router.ts:1036-1113), inspiration-catalog versioned JSON.
- McpServer portable subset: slug/name/description/transport/endpoint/command/args/enabled/revision. NOT portable: headers, env, secretId (Secret FK), oauthSessions. BotMcpServer (allowAllTools, allowedTools) is per-bot assignment — portable with security downgrade.
- Connection authorization is connector-delegated (composio OAuth; rakazo stores status/providerRef). McpServer OAuth is McpOAuthSession (deployment-local).
- Marketplace route: /app/marketplace + ShellPage `marketplaceEntry` prop + the three hijack guards (Shell.tsx ~893/~1135/~1151 — the exact pattern fixed for hubEntry in 002); catalog seam mirrors inspiration-catalog.ts (Zod schema + CATALOG_VERSION + validate fn).

## Resolver

| Question | Resolution | Classification | Evidence / rationale | Verification consequence |
| --- | --- | --- | --- | --- |
| Bundle container | Single JSON document (no ZIP). Assets = data URLs / bundled avatarKey references inside the JSON. Total cap 2 MB (schema max + request body limit). | decided (kills #2 traversal + #3 zip-bomb + #15 size by construction) | A1 "versioned JSON"; assets-as-files invited filesystem writes for zero v1 benefit | V2 rejects >2MB; V1 round-trip |
| Prototype pollution | Immediate Zod parse with `.strict()` top schema (fresh output objects, unknown keys rejected) | decided (proven risk #1) | inspiration-catalog.ts:62 parses raw | V2: `__proto__`-bearing bundle rejected |
| Schema version | `version` literal exact-match ("1"); missing/unknown → reject | decided (#4) | no fallback parsing | V2 unknown-version rejection |
| Review enforcement | Two-phase server-side: `agents.previewImport` (validate → review manifest + 10-min importToken) and `agents.import` (token + confirm required); review screen is the token UI | decided (#5 blocker — server-side, not UI promise) | no dry-run RPC exists today | V2: import without preview token → typed error |
| allowAllTools | Import forces `allowAllTools=false`; per-tool allowlist = bundle's declared tools, displayed on review screen | decided (#6 blocker) | router.ts:1102 proven auto-grant pattern | V2/V4: installed MCP has allowAllTools=false |
| Skill content | Content displayed in full on review screen; imported skills forced `source: 'user'` (never plugin/builtin — proven spoofable); runtime treats them exactly like locally created skills | decided (#7, #14) | router.ts:1118 proven; schema default 'user' | V14-style test: smuggled source ignored |
| Export secret leak | `agents.export` runs the existing containsSecret scan over instructions/description/skills; hit → export REFUSED listing flagged fields (fail-closed) | decided (#8 major) | containsSecret proven used in router | V1: secret-bearing agent export refused |
| MCP headers/env/secretId | Never serialized (schema omits); import schema rejects bundles containing them | decided (#9 major) | schema.prisma:1099 proven | V2: headers-bearing bundle rejected |
| Catalog trust | v1: HTTPS-only operator fetch, URL set by the operator (= operator accepts trust), content Zod-validated; HMAC signing deferred (future) | assumed, documented | integration-catalog.ts:28-34 proven fetch pattern | catalog with invalid schema → inconclusive + skipped item |
| Catalog URL validation | try/catch around URL construction → typed 400 | trivial fix | #11 | — |
| Search query | URLSearchParams.set encodes correctly — not a defect | proven non-defect | #12; integration-catalog.ts:19 | — |
| Mobile | Recorded degradation v1 (marketplace is desktop/web; mobile keeps existing surfaces) | decided (consistent with 001/002) | #13; spec R-lanes target web first | V-note in QA report |
| Import size limit | 2 MB bundle cap via schema + body limit (#15) | decided | request-body-limit middleware proven | V2 oversized rejection |
| Q2 skill format | AgentSkill IS the canonical format (name/description/content/SKILL.md/source); TaughtSkill excluded from v1 bundles | proven (research task closed) | schema + agent-skills.ts flows | V1 round-trip includes skills |
| Name collisions | Import: identical existing skill → skip (idempotent); different content same name → disambiguated suffix, never overwrite | decided | unique constraint spaceId+userId+name proven | round-trip test in populated space |
| CapabilityInstall audit | Marketplace installs write CapabilityInstall rows with source='marketplace' (existing R4 enforcement point) | decided (proven table + consent flow) | schema.prisma:831-847; investigator | install → CapabilityInstall row present |
| Marketplace route/UI | /app/marketplace + ShellPage `marketplaceEntry` + 3 hijack guards; MarketplacePage mirrors HubPage structure; browse/search/detail-drawer/install flow | decided | 002 hubEntry pattern proven; Shell.tsx:366 | V3 e2e |
| Catalog seam interface | `CatalogSource` (versioned items) with three providers merged server-side in `marketplace.list`; no provider branches at call sites | decided (proven inspiration-catalog + experts.list patterns) | investigator Q6 | marketplace.list merges bundled + configured |

## Purpose conflicts

None. All findings are technical/security resolutions within the confirmed purpose.

## Result

- [x] Ready for design-first and planning
- [ ] Return to Purpose Gate
- [ ] Blocked by external authority or missing evidence
