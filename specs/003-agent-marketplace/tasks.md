# Tasks — 003 Agent import/export + marketplaces

Spec: specs/003-agent-marketplace/spec.md · Matrix: verification-matrix.md · Grill: .super-speckit/grills/003-agent-marketplace/spec-grill.md · Route: milestone

Red-green per seam; DB-gated suites use the isolated harness recipe (fresh container + own API process).

## Slice S1 — bundle format + export/import + security core

- [ ] T1 (P1) `AgentBundleSchema` in packages/contracts/src/agent-bundle.ts: version literal "1" (strict), manifest (portable Bot fields), skills[] (name/description/content SKILL.md), mcpServers[] (slug/name/description/transport/endpoint/command/args/declaredTools), avatarKey; 2 MB cap; `.strict()` top-level
- [ ] T2 (P1) `agents.export` RPC: serialize bot (repos.getBot mapped DTO) + AgentSkills + BotMcpServer refs + avatarKey; containsSecret scan over free-text → REFUSE with flagged-field list
- [ ] T3 (P1) Two-phase import: `agents.previewImport` (parse/validate → review manifest + 10-min importToken) + `agents.import` (token + confirm; creates bot via createBot machinery, skills via AgentSkill creation source='user' with collision skip/disambiguate, McpServer from portable fields + BotMcpServer allowAllTools=false, CapabilityInstall source='marketplace')
- [ ] T4 (P1) Security validations: strict parse (proto/unknown keys), exact version, 2 MB, reject headers/env/secretId in mcpServers, reject smuggled source, token required
- [ ] T5 (P1) Red-green tests: V1 round-trip (incl. secret-refusal), V2 all rejections, V6 machinery + CapabilityInstall row

## Slice S2 — catalog seam + marketplace UI

- [ ] T6 (P1) Catalog seam: `CatalogSource` interface + bundled provider (static, from INSPIRATION/experts-style data) + operator-URL provider (server fetch, Zod-validated, HTTPS, URL try/catch → 400) + `marketplace.list` merge (bundled never blocked by a failed source → inconclusive item)
- [ ] T7 (P1) `/app/marketplace` route + ShellPage `marketplaceEntry` + 3 `!marketplaceEntry` hijack guards (hub pattern); MarketplacePage: search + kind chips + card grid (avatar/title/line/provenance badge/Install)
- [ ] T8 (P1) Detail drawer (capabilities, required connections, declared tools) + Import Review modal (two-phase preview → confirm)
- [ ] T9 (P1) E2E marketplace.spec.ts: V3 browse → search → install agent+skill+MCP → agent appears → run proceeds (isolated-API recipe)
- [ ] T10 (P2) V5 seam tests: bundled-only zero-config; operator double merges; invalid source → inconclusive skip

## Slice S3 — security review + closure

- [ ] T11 (P1) V4: independent security-reviewer lane on the import path (bundle attacks, capability escalation, catalog trust) — findings → bug loop
- [ ] T12 (P2) V7 mobile degradation note + V8 legacy suite run
- [ ] T13 (P1) Final matrix closure + milestone reassess

## Dependencies

S1 → S2 → S3. T4 gates T3's import path. Security review (T11) may spawn bug loops before closure.
