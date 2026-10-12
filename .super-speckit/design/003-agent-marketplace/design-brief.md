# 003-agent-marketplace — Marketplace + import review

## Problem
Marketplace page (/app/marketplace, ShellPage marketplaceEntry, three hijack guards per the 002 hubEntry pattern): header with search input + kind filter chips (Agents/Skills/MCP); browse grid of catalog cards (visual/avatar, title, one-line description, provenance badge: Bundled/Operator/Registry, Install button); card click opens a detail drawer (full description, capabilities, required connections, declared tools); Install opens the Import Review modal — two-phase: preview manifest (bot fields preview, skills with FULL content, MCP servers with transport/endpoint and forced allowAllTools=false note, required-connections list) then Confirm install. All monochrome semantic tokens; provenance badges outline-only; bots carry the only color; copy budget: titles two words, cards title+one line, review sections noun-labeled. No ratings/install-counts. Reference pattern: HubPage zones + expert-create cards.

## Assumptions to review

- User, hierarchy, and state behavior need product confirmation.
- Reuse the repository design system when one is declared.
- This prototype is not production code.
