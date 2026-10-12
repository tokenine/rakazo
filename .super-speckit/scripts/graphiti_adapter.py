#!/usr/bin/env python3
"""Optional Graphiti retrieval adapter for the Super-SpecKit Project Atlas (Stage-2 pilot).

Authority boundary (docs/research/graphiti-atlas-evaluation.md):
  committed source / command output  >  this graph  >  agent verification.
The graph is a derived, staleness-prone retrieval index. Every query result is a lead:
agents MUST reopen the cited source paths and run required checks. Any unavailability,
stale packet, missing credential, or empty result is `inconclusive` — never a pass and
never a blocker for the file-only Atlas.

Run under the project venv (graphiti-core needs Python 3.10+):
  .venv-graphiti/bin/python .super-speckit/scripts/graphiti_adapter.py --repo . <doctor|ingest|query> [args]

Secrets are read from the environment only (see config keys *_from_env); never stored here.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
from datetime import datetime
from pathlib import Path

CONFIG_REL = ".super-speckit/config/super-speckit.yml"
PACKETS_GLOB = ".super-speckit/atlas/graph/*.yaml"
RECEIPTS_REL = ".super-speckit/atlas/graph/receipts"

DEFAULTS = {
    "enabled": False,
    "graph_db": {"driver": "falkordb", "host": "localhost", "port": 6379, "database": "default_db"},
    "embedder": {
        "base_url": "http://localhost:11434/v1",
        "model": "nomic-embed-text",
        "dim": 768,
        "tags_url": "http://localhost:11434/api/tags",
    },
    "llm": {
        "key_from_env": "ANTHROPIC_API_KEY",
        "base_url_from_env": "ANTHROPIC_BASE_URL",
        "model_from_env": "ANTHROPIC_MODEL",
    },
    "num_results": 8,
}


def load_config(repo: Path) -> dict:
    merged = {**DEFAULTS, "enabled": DEFAULTS["enabled"], "graph_db": dict(DEFAULTS["graph_db"]),
              "embedder": dict(DEFAULTS["embedder"]), "llm": dict(DEFAULTS["llm"])}
    path = repo / CONFIG_REL
    if path.exists():
        import yaml

        data = yaml.safe_load(path.read_text()) or {}
        kg = data.get("knowledge_graph") or {}
        merged["enabled"] = bool(kg.get("enabled", DEFAULTS["enabled"]))
        for key in ("graph_db", "embedder", "llm"):
            merged[key].update(kg.get(key) or {})
        if kg.get("num_results"):
            merged["num_results"] = int(kg["num_results"])
    return merged


def sha16(path: Path) -> str | None:
    if not path.exists():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def emit(payload: dict) -> None:
    print(json.dumps(payload, indent=2, default=str))


def inconclusive(reason: str, **extra) -> int:
    emit({"status": "inconclusive", "reason": reason, **extra})
    return 0  # inconclusive is a valid outcome, not an error


def build_graphiti(repo: Path, cfg: dict):
    from graphiti_core import Graphiti
    from graphiti_core.cross_encoder.client import CrossEncoderClient
    from graphiti_core.driver.falkordb_driver import FalkorDriver
    from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
    from graphiti_core.llm_client.anthropic_client import AnthropicClient
    from graphiti_core.llm_client.config import LLMConfig

    class _NoCrossEncoder(CrossEncoderClient):
        """Pilot uses RRF search recipes only. Raising keeps any accidental
        cross-encoder path loud: the query command surfaces it as inconclusive."""

        async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
            raise RuntimeError("cross-encoder reranking is not configured in this pilot; use RRF search recipes")

    db = cfg["graph_db"]
    emb = cfg["embedder"]
    llm = cfg["llm"]
    api_key = os.environ.get(llm["key_from_env"], "")
    base_url = os.environ.get(llm["base_url_from_env"]) or None
    model = os.environ.get(llm["model_from_env"]) or None
    if not api_key:
        raise RuntimeError(f"missing env {llm['key_from_env']}")

    import anthropic

    anthropic_client = AnthropicClient(
        client=anthropic.AsyncAnthropic(api_key=api_key, base_url=base_url),
        config=LLMConfig(api_key=api_key, model=model, base_url=base_url),
    )
    embedder = OpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            api_key="ollama-local", base_url=emb["base_url"],
            embedding_model=emb["model"], embedding_dim=int(emb["dim"]),
        )
    )
    driver = FalkorDriver(host=db["host"], port=int(db["port"]), database=db.get("database", "default_db"))
    return Graphiti(graph_driver=driver, llm_client=anthropic_client, embedder=embedder, cross_encoder=_NoCrossEncoder())


def group_id(repo: Path) -> str:
    import re

    return "atlas-" + re.sub(r"[^A-Za-z0-9_-]", "-", repo.resolve().name)


async def cmd_doctor(repo: Path, cfg: dict, args: argparse.Namespace) -> int:
    import redis.asyncio as aredis

    checks: dict[str, object] = {}
    db = cfg["graph_db"]
    emb = cfg["embedder"]
    llm = cfg["llm"]
    try:
        r = aredis.Redis(host=db["host"], port=int(db["port"]), socket_connect_timeout=3)
        checks["graph_db"] = {"ok": bool(await r.ping()), "host": db["host"], "port": db["port"]}
        await r.aclose()
    except Exception as e:
        checks["graph_db"] = {"ok": False, "error": type(e).__name__}
    try:
        import httpx

        root = emb["tags_url"]
        resp = httpx.get(root, timeout=5)
        models = [m.get("name", "") for m in resp.json().get("models", [])] if resp.status_code == 200 else []
        checks["embedder"] = {"ok": any(m.startswith(emb["model"]) for m in models),
                              "model": emb["model"], "server": f"{resp.status_code}"}
    except Exception as e:
        checks["embedder"] = {"ok": False, "error": type(e).__name__}
    checks["llm_env"] = {name: bool(os.environ.get(name)) for name in
                         (llm["key_from_env"], llm["base_url_from_env"], llm["model_from_env"])}
    try:
        import graphiti_core

        checks["graphiti_core"] = {"ok": True, "imported": True}
    except Exception as e:
        checks["graphiti_core"] = {"ok": False, "error": type(e).__name__}
    if args.live:
        try:
            graphiti = build_graphiti(repo, cfg)
            await graphiti.add_episode(  # cheapest possible live write/read probe
                name="doctor-live-probe", episode_body="doctor live probe: rakazo atlas adapter alive",
                source_description="graphiti_adapter doctor --live", reference_time=datetime.now().astimezone(),
                group_id=group_id(repo),
            )
            checks["live_write"] = {"ok": True}
        except Exception as e:
            checks["live_write"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    emit({"status": "ok" if all(
        c.get("ok", True) for c in checks.values() if isinstance(c, dict)) else "degraded",
        "enabled": cfg["enabled"], "checks": checks,
        "note": "graph retrieval is a lead, not proof; files and git remain the authority"})
    return 0


async def cmd_ingest(repo: Path, cfg: dict, args: argparse.Namespace) -> int:
    if not cfg["enabled"] and not args.enable:
        emit({"status": "disabled",
              "hint": f"set knowledge_graph.enabled: true in {CONFIG_REL} or pass --enable"})
        return 2
    import yaml

    packets = sorted((repo / ".super-speckit/atlas/graph").glob("*.yaml")) if (repo / ".super-speckit/atlas/graph").exists() else []
    if not packets:
        return inconclusive("no packet files found", glob=PACKETS_GLOB)
    stale, nodes, schema_ok = [], [], True
    observed_sha = None
    for pf in packets:
        data = yaml.safe_load(pf.read_text()) or {}
        if data.get("schema") != "atlas-graph-packets/1":
            schema_ok = False
            continue
        observed_sha = data.get("observed_at_sha") or observed_sha
        for node in data.get("nodes", []):
            src = node.get("source", {})
            path = repo / src.get("path", "")
            current = sha16(path)
            pinned = src.get("content_sha256")
            entry = {"id": node.get("id"), "kind": node.get("kind"), "path": src.get("path"),
                     "pinned_sha256_16": pinned, "current_sha256_16": current}
            if current != pinned:
                entry["stale"] = True
                stale.append(entry)
            nodes.append(entry)
    if not nodes or not schema_ok:
        return inconclusive("no valid atlas-graph-packets/1 documents")

    try:
        graphiti = build_graphiti(repo, cfg)
        await graphiti.build_indices_and_constraints()
    except Exception as e:
        return inconclusive(f"graphiti/graph-db unavailable: {type(e).__name__}: {e}")

    observed_at = datetime.now().astimezone()
    if observed_sha:
        import subprocess

        iso = subprocess.run(["git", "show", "-s", "--format=%cI", observed_sha],
                             cwd=repo, capture_output=True, text=True).stdout.strip()
        if iso:
            observed_at = datetime.fromisoformat(iso)

    ingested, failed = [], []
    for pf in packets:
        data = yaml.safe_load(pf.read_text()) or {}
        if data.get("schema") != "atlas-graph-packets/1":
            continue
        for node in data.get("nodes", []):
            try:
                await graphiti.add_episode(
                    name=node["id"],
                    episode_body=yaml.safe_dump(node, sort_keys=False),
                    source_description=f"atlas graph packet {pf.name}",
                    reference_time=observed_at,
                    group_id=group_id(repo),
                )
                ingested.append(node["id"])
            except Exception as e:
                failed.append({"id": node.get("id"), "error": f"{type(e).__name__}: {e}"})

    receipts = repo / RECEIPTS_REL
    receipts.mkdir(parents=True, exist_ok=True)
    receipt = {
        "receipt": "graphiti-ingest/1",
        "at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "graphiti_ingested": len(ingested), "failed": failed,
        "stale_packets": stale, "observed_at_sha": observed_sha,
        "enabled_via": "--enable" if args.enable else "config",
        "note": "derived projection only; git history and files remain the time and truth authority",
    }
    out = receipts / f"{datetime.now().strftime('%Y%m%dT%H%M%SZ')}-ingest.json"
    out.write_text(json.dumps(receipt, indent=2) + "\n")
    emit({**receipt, "status": "ok" if ingested and not failed else ("partial" if ingested else "failed"),
          "receipt_path": str(out.relative_to(repo))})
    return 0


async def cmd_query(repo: Path, cfg: dict, args: argparse.Namespace) -> int:
    if not cfg["enabled"] and not args.enable:
        emit({"status": "disabled",
              "hint": f"set knowledge_graph.enabled: true in {CONFIG_REL} or pass --enable"})
        return 2
    try:
        from graphiti_core.search.search_config_recipes import (
            EDGE_HYBRID_SEARCH_RRF, NODE_HYBRID_SEARCH_RRF,
        )

        graphiti = build_graphiti(repo, cfg)
        edges = await graphiti.search_(args.q, config=EDGE_HYBRID_SEARCH_RRF, group_ids=[group_id(repo)])
        nodes = await graphiti.search_(args.q, config=NODE_HYBRID_SEARCH_RRF, group_ids=[group_id(repo)])
    except Exception as e:
        return inconclusive(f"graph unavailable: {type(e).__name__}: {e}")

    facts = [
        {"fact": getattr(e, "fact", ""), "name": getattr(e, "name", ""),
         "valid_at": getattr(e, "valid_at", None), "invalid_at": getattr(e, "invalid_at", None),
         "episode_uuids": [str(u) for u in (getattr(e, "episodes", None) or [])]}
        for e in (getattr(edges, "edges", None) or [])
        if getattr(e, "fact", "")
    ]
    ents = [
        {"name": getattr(n, "name", ""), "summary": (getattr(n, "summary", "") or "")[:400],
         "labels": list(getattr(n, "labels", None) or [])}
        for n in (getattr(nodes, "nodes", None) or [])
    ]
    if not facts and not ents:
        return inconclusive("no matching facts in graph; use the file Atlas (super-speckit.atlas)")
    emit({"status": "ok", "query": args.q, "facts": facts[:args.num_results], "entities": ents[:args.num_results],
          "provenance_rule": "reopen the cited source paths and verify against git before acting on any fact"})
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--repo", default=".")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--enable", action="store_true", help="override disabled config for this invocation")
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("doctor", help="report readiness of every dependency", parents=[common])
    d.add_argument("--live", action="store_true", help="include one live episode write")
    i = sub.add_parser("ingest", help="ingest allowlisted hash-versioned packets", parents=[common])
    q = sub.add_parser("query", help="ranked facts with provenance; inconclusive when unavailable", parents=[common])
    q.add_argument("--q", required=True)
    q.add_argument("--num-results", type=int, default=None)
    a = p.parse_args()
    repo = Path(a.repo).resolve()
    cfg = load_config(repo)
    if a.cmd == "query" and a.num_results:
        cfg["num_results"] = a.num_results
    fn = {"doctor": cmd_doctor, "ingest": cmd_ingest, "query": cmd_query}[a.cmd]
    try:
        return asyncio.run(fn(repo, cfg, a))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
