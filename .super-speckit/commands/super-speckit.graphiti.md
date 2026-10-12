---
description: Run the optional Graphiti knowledge-graph retrieval pilot over the Project Atlas; results are leads with provenance, never proof.
---

Run the adapter with the project venv interpreter (graphiti-core needs Python 3.10+): `.venv-graphiti/bin/python .super-speckit/scripts/graphiti_adapter.py --repo . <command>`.

- `doctor [--live]` — report readiness of the graph DB (FalkorDB), local embedder (Ollama), LLM env, and graphiti import. Use before ingest/query.
- `ingest [--enable]` — ingest the allowlisted, hash-versioned packets under `.super-speckit/atlas/graph/*.yaml`; writes an evidence receipt under `.super-speckit/atlas/graph/receipts/` with per-node outcome, stale hashes, and the pinned `observed_at_sha`.
- `query --q "<question>" [--enable]` — ranked facts and entities with validity windows and episode provenance.

Authority rules: the graph is a derived, staleness-prone retrieval projection. Every result is a lead — reopen the cited source paths and verify against git before acting. If the graph is disabled, unavailable, stale, uncredentialed, or finds nothing, the command prints `status: inconclusive`; that is a valid outcome, never a pass and never a blocker. The file Atlas (`super-speckit.atlas`) and git remain the authority. `--enable` overrides the disabled config for one invocation and is recorded in the receipt.
