# Final Static Security Review — 003 Agent Marketplace S1 at `800eb1e4`

- **Candidate reviewed:** `800eb1e4` (three medium fixes stacked on `61154e37`)
- **Lane:** independent `security-reviewer`, read-only, static
- **Standing:** static evidence only; substitutes for the unconfigured `gates.ocr_review` adapter
  and per kit policy **can never** satisfy a runtime matrix row
- **Verdict:** ✅ **0 critical, 0 high — the critical/high merge gate passes.** 1 medium (a real,
  runtime-confirmed secret leak) and 3 low remain.

This is the fourth lane of the feature and the first to clear the high bar. Prior: 3 high / 4
medium / 2 low at `3178940e`, then 1 high / 3 medium / 1 low at `16c261cf`.

## Triage of the four fixes

| ID | Fix | Status | Basis |
|---|---|---|---|
| AGENT-BUNDLE-001 / BUG-003-S1-05 | `61154e37` | ✅ **fixed** | preflight selects `secretId` (`router.ts:5236-5243`) and refuses reuse when it is non-null (`:5255-5271`) **before** `repos.createBot` and every write (`:5274+`). Runtime credential loading remains scoped by server secret + `context.spaceId`/`userId` (`mcp-connector.ts:326-345`). The cache cap does not weaken it: eviction yields a cache miss at `:5202-5213`, and a surviving preview still reaches the credential check. |
| AGENT-BUNDLE-004 | `8abb09f5` | ❌ **partial — medium** | see below |
| AGENT-BUNDLE-005 | `466a8bcf` | ✅ fixed (with a low residual) | parse-time refine rejects non-HTTP(S), local HTTP, `0.0.0.0`, link-local. Residual: `isLocalMcpHost()` is exact-match and called only in the `http:` branch, so HTTPS loopback, most of `127/8`, IPv4-mapped IPv6, private-DNS answers and `localhost.` parse. **Confirmed not reachable** — those route through `createSafeRemoteFetch` (`mcp-connector.ts:358-381` → `mcp-transport.ts:111-158`), which rejects private hostnames *and* DNS answers and pins lookup (`remote-mcp.ts:120-180, 225-257`). This is `BUG-003-S1-06`, low hardening. |
| AGENT-BUNDLE-006 | `800eb1e4` | ✅ fixed (with a low interaction) | one process-wide map, bounded input, expired entries removed, over-capacity sorted by `expiresAt` and evicted soonest-first (`router.ts:291-303`); the cap is global so many actors cannot make residency unbounded. Off-by-one: prune runs before `Map.set` and only evicts while `size > 50`, so steady-state max is 51, not 50 — still bounded. |
| AGENT-BUNDLE-010 | — | confirmed **low**, do not promote | export loads every space `AgentSecret` without the owner check the `agentSecrets` APIs use. Membership oracle, not disclosure. |

## The surviving medium: AGENT-BUNDLE-004 residual → BUG-003-S1-07

The export endpoint loop rejects userinfo and query strings and applies `detectCredentialPatterns()`
to each raw pathname segment, then serializes the endpoint verbatim. It never consults the
already-loaded `storedSecrets`.

**Runtime-confirmed by the checker** (real Postgres, secret with no provider prefix stored as a
space `AgentSecret`):

```
EXPORT-STATUS: 200 LEAKS-SECRET: true
```

Export **succeeds** and the secret is in the body. Also: no percent-decoding, so `ghp%5F…` evades
the segment regex. The ordinary `/api/v1/mcp` case still exports, so this is a false-negative
rather than an over-broad refusal.

**The root cause is a split detector.** Two detectors exist in this file and the path loop uses only
the narrow one: `containsSecret(value, storedSecrets)` (known-secret substring, catches anything the
space stores) and `detectCredentialPatterns` (high-confidence provider prefixes only, deliberately
narrow because false positives block legitimate exports). The free-text scan uses both; the path
scan uses one. Fix dispatched to `ss/bug/003-s1-07`, which also covers the inbound import direction.

## New low findings this run

| ID | Finding |
|---|---|
| AGENT-BUNDLE-011 | The process-wide preview cap lets one authenticated actor evict other actors' valid previews → repeatable commit-denial DoS. Actor is part of the key (`router.ts:287-289`) but all actors share one map and one eviction order. No per-actor quota or route rate limit found. Confidentiality/integrity unaffected — another actor still cannot retrieve the victim's bundle. |
| AGENT-BUNDLE-012 | The endpoint refine accepts public plain-HTTP endpoints that import successfully but are **guaranteed to fail at runtime** (`mcp-transport.ts:75-87` rejects all non-HTTPS unless explicitly local). An untrusted bundle can therefore install a nonfunctional MCP integration. The schema message also says "public HTTPS" while the code admits public HTTP (`agent-bundle.ts:118`). |

## Bypass attempts on the new controls

| Vector | Result |
|---|---|
| HTTPS loopback (`https://localhost`, `https://127.0.0.1`, `https://[::1]`) | parses, blocked at the sink — defence-in-depth gap only |
| link-local `169.254.169.254` | parses, blocked at the sink |
| link-local over HTTP | rejected at parse time |
| public plain HTTP | **accepted at parse time**, fails at runtime (AGENT-BUNDLE-012) |
| percent-encoded provider token in an export path | **not detected** (BUG-003-S1-07) |
| opaque stored secret in an export path | **not detected, leaks** (BUG-003-S1-07, runtime-confirmed) |
| many actors to defeat the cache cap | does not work — the cap is global |
| credentialed-server reuse after cache eviction | does not work — the guard runs before persistence |

## Prior clean claims — re-verified

Prototype pollution, cross-space authorization, bundle privilege fields (`source` forced to `user`,
ownership/`isDeploymentOwner` not bundle-originated), path/file/SQL injection, and token replay
(one-use, actor-checked, expiry-enforced, length-guarded `timingSafeEqual`) all still hold at this
tip.

## Gate honesty

`merge.require_ocr_triage_complete: true` is satisfied here the way `001-s1-run1` satisfied it: a
triage artifact exists, produced by an independent read-only lane, with every finding recorded
per-ID. That triage is complete **as an artifact**; it is static evidence and does not convert any
runtime matrix row. The lane did not pass — it cleared the high bar and still reported a real medium,
which is the honest outcome.
