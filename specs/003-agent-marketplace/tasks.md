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

## Phase 4: Convergence

Note: this feature has no plan.md (spec + tasks + grill served as intent; recorded deviation).
Converged 2026-10-02: Slice S1 (T1–T5) fully implemented and merged (squashed into d59c3587,
ancestor of HEAD; 2,043-line regression suite; S1 security lane 7 retest rounds, 0
crit/high/med). Slices S2 (T6–T10) and S3 closure (T11 final lane, T13) remain NOT STARTED
and are already tracked as unchecked tasks T6–T13 above — not duplicated here. Recorded
without tasks: V8 legacy-suite re-run is T12; BUG-003-S1-06 is a low finding with an open
accept-or-fix decision (task below); state index says `state: "merged"` with
`release.not_merged: true` and every checkbox unchecked while S2/S3 are pending — the
bookkeeping task below reconciles this.

- [ ] T14 Promote a minimal live-Postgres smoke of the import path into the mainline suite
      (mainline V6 runs on a prisma double; live-DB probes exist only as QA artifacts under
      .super-speckit/qa/003-s1-retest*/ — the S1 reassessment flagged mock-only V6 as a
      load-bearing failure mode) per T5/V6 (partial)
- [ ] T15 Decide and record accept-or-fix for open low finding BUG-003-S1-06
      (.super-speckit/state/features/003-agent-marketplace.json security_review) per
      T11/V4 (partial)
- [ ] T16 Reconcile feature state bookkeeping with reality: tasks.md checkboxes for merged
      S1 tasks (T1–T5), the `state: "merged"` + `release.not_merged: true` contradiction in
      the state JSON, and the unresolvable candidate_sha da30d1ae (content squashed into
      d59c3587) per T13 bookkeeping (contradicts)
