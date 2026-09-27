# Feature 003 — Agent import/export + marketplaces (agents, skills, MCP)

Status: specified · clarifications required before plan (highest scope risk of the three)
Priority: 3 of 3 (user-ordered)
Base commit: d7a4e523 (atlas base)

## Problem

Agents (experts) are hand-built per deployment. Users want to move an agent between
deployments/accounts (import/export) and discover ready-made agents, skills, and MCP servers
in a browsable marketplace with one-click install — AutoClaw-style "Skills & Connectors" but
at larger scale.

## Requirements

1. R1 — Export an agent as a portable bundle: persona/sections, tool configuration, skills, referenced MCP server definitions, avatar — with secrets explicitly excluded (never exported).
2. R2 — Import that bundle into any deployment with a pre-install review screen (what will be created, what capabilities it grants), then adjust to local model credentials.
3. R3 — A marketplace surface to browse and install: agents, skills, and MCP servers — searchable, categorized, with detail views showing capabilities and required connections.
4. R4 — Install respects the security constitution: capabilities, approvals, and consent flows apply exactly as to a locally created agent; nothing auto-grants host access.
5. R5 — Skill/MCP install integrates with the existing skills (`AgentSkill`/`TaughtSkill`), MCP (`McpServer`/`BotMcpServer`) and connectors (`Connection`) machinery — no parallel system.

## Product assumptions made autonomously (reversible)

- A1: Bundle format = versioned JSON (+ assets as files) defined in `packages/contracts` — provider-neutral, human-inspectable, no proprietary packaging.
- A2: (updated 2026-09-28 after Q1) Marketplace is a **catalog seam**: v1 ships a built-in default catalog; operator-configured catalog URLs and a future hosted public registry plug into the same interface. No hosted service must exist for v1 to work.
- A3: No payments/ratings/accounts in v1; install counts or similar telemetry excluded.
- A4: Export format covers what is portable; model credentials, user data, memory, and secrets are deployment-local and never leave with the bundle.

## Resolved questions (maintainer, 2026-09-28)

- Q1 resolved — hybrid marketplace: the product may end up either enterprise/closed or open to anyone, so the marketplace must support **both**: a hosted public registry we can run later, and operator-configured catalogs for closed deployments, with a **built-in default catalog that ships with the product** when nobody configures anything. Catalog/registry source is a provider-neutral seam (like every other external service): same client, swappable backends (bundled → operator URL → hosted registry).
- Q3 resolved — MCP items include **both** remote server references (URL + auth guidance) **and** curated bundled local servers, selectively added by us for quality. Additionally, if a valid third-party MCP registry/marketplace exists, the catalog should be able to pull/index from it so nearly every MCP is browsable — again behind the same neutral catalog seam, with third-party items clearly labeled by provenance and reviewed before they can be "bundled" (pulled items stay reference-only until a maintainer curates them).

## Open questions (still open)

- Q2: Skill format: do existing `AgentSkill`/`TaughtSkill` records serialize cleanly, or is a canonical skill definition format needed first? (research task)

## Verification sketch

- V1: Unit — export→import round-trip preserves agent behavior config byte-for-byte (modulo ids); secrets excluded.
- V2: API — import rejects malicious bundles (path traversal in assets, oversized, unknown schema versions).
- V3: E2E (web) — browse marketplace → install agent + a skill + an MCP server → agent appears in space and runs.
- V4: Security review (constitution §7) on the import path.
