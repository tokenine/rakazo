# Project Atlas — Rakazo / Ai7

Descriptive, evidence-backed explanation of the system as it exists at a known commit.
This is a comprehension aid, never authority over runtime behavior: raw code and tests
remain the executable truth.

- **Base commit:** `d7a4e523cd5941e2775e2f5a5ce825bcb734d283` (branch `speckit-setup`, 2026-09-28)
- **Scope:** whole repository at shallow zoom (C4 level 1 context + capability map + two runtime scenarios). Code-level views are intentionally out of scope until a feature needs them.
- **Evidence sources:** local code, tests, `AGENTS.md`, `docs/HANDOFF.md`, `REBRAND-NOTES.md`, compose/prisma manifests. No production telemetry was read.
- **Freshness:** on-demand, incrementally refreshed from diffs after material merges. Stale sections are declared in `risks-and-unknowns.md`.
- **Labels:** claims are `verified` (evidence path given) or `inferred` (reasoned, unverified). Anything else is `unknown` and lives in `risks-and-unknowns.md`.

| File | Question it answers |
| --- | --- |
| `manifest.yml` | When was this generated, from what, from which commit |
| `product-model.md` | What is the product, who uses it, what are the capabilities |
| `system-context.md` | C4 level 1: people, external systems, boundaries |
| `capability-map.md` | Capability → owning component → user-facing outcome |
| `architecture.md` | C4 container view of apps and packages |
| `runtime-scenarios/` | Representative flows end to end |
| `dependencies.md` | External services, queues, databases, direction |
| `decisions/` | Durable architecture decision records (links) |
| `risks-and-unknowns.md` | Stale areas, inferred facts, unexamined boundaries |
