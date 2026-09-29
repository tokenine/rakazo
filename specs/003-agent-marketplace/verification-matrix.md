# Verification matrix — 003 Agent import/export + marketplaces

Route: milestone · Grill: .super-speckit/grills/003-agent-marketplace/spec-grill.md · Design: .super-speckit/design/003-agent-marketplace/decision.json

| # | Requirement (spec ref) | Verification | Evidence expected | Slice |
| --- | --- | --- | --- | --- |
| V1 | R1/R2 round-trip | Unit: export → import preserves name/title/description/instructions/skills/MCP refs modulo ids; agent with containsSecret hit → export REFUSED listing fields | vitest (contracts + repos seams) | S1 |
| V2 | R2/R4 malicious bundles | Unit: rejected — `__proto__` keys, unknown/missing version, >2 MB, headers/env/secretId present, unknown top-level keys (strict), import without preview token; installed MCP forced allowAllTools=false; imported skill forced source='user' (smuggled 'builtin' ignored) | vitest | S1 |
| V3 | R3 browse/install | E2E: marketplace renders bundled catalog → search filters → detail drawer → Install → review modal → confirm → bot appears in space → agent runs | Playwright spec | S2 |
| V4 | R4 security review | Independent security-review lane on the import path (constitution §7 + grill findings) — verdict recorded | security-reviewer report | S3 |
| V5 | A2 catalog seam | Unit/Integration: bundled default works with zero config; operator-URL provider merges (test double); invalid catalog source → item skipped + status inconclusive (never blocks bundled) | vitest | S2 |
| V6 | R5 machinery reuse | Unit/Integration: install creates AgentSkill + McpServer/BotMcpServer (allowAllTools=false) + CapabilityInstall row with source='marketplace'; no new tables | vitest + DB assertion | S1 |
| V7 | Mobile | Recorded degradation note (marketplace desktop/web v1) | QA note | S3 |
| V8 | Legacy compatibility | Existing expert-create/duplicate/export-bot suites pass unmodified | CI suites | S1-S3 |
