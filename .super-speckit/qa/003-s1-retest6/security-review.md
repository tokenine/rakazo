# Merge-Gate Static Security Review — 003 S1 at `f2d4e95f`

- **Candidate reviewed:** `f2d4e95f` (BUG-003-S1-07 fix, on top of `800eb1e4`)
- **Lane:** independent `security-reviewer`, read-only, static
- **Verdict:** ❌ **NO-GO.** 0 critical, 0 high — but BUG-003-S1-07 is only **partially** closed and
  one medium remains merge-blocking. 4 low.

## Why the previous "0 high" verdict did not carry forward

The `800eb1e4` lane cleared the critical/high bar. `f2d4e95f` was written to close that lane's one
medium, and it does block the exact reproducer. But a partial fix of a secret-leak class is not a
closed leak: the check still splits the pathname before matching, and `AgentSecretInputSchema`
permits `/` in a secret value (`packages/contracts/src/domain.ts:37-40`). A secret that spans a
segment boundary therefore matches no segment.

**Runtime-confirmed by the checker**, not just static:

```
secret stored as: "opaque/secret"
pathname:         /t/opaque/secret
segments scanned: ["t","opaque","secret"]
any segment contains whole secret? false
EXPORT-STATUS: 200 LEAKS-SECRET: true
```

## Open medium

| ID | Finding |
|---|---|
| BUG-003-S1-07 (partial) | `containsSecret` runs on per-segment, once-decoded values (`router.ts:5519-5522` export, `:5141-5145` import) instead of on representations of the whole pathname. Reachable on both directions: `agentSecrets.put` (arbitrary 1–16384-char values including `/`) → `mcp.servers.create` persists an endpoint → `mcp.assignments.approve` attaches it → `agents.export` splits, matches nothing, and serialises the original endpoint into the bundle (`:5547-5558`). The import path has the same control and then caches and persists. |

Three further representations the current check misses, all from the same root:

- **nested encoding** — `%25` decodes once to `%`; one pass is not enough
- **Unicode canonical equivalence** — NFC vs NFD, no normalisation on either side
- **decode can remove a match** — `ghp_<token>%5F` decodes to `ghp_<token>_`, and the trailing
  underscore defeats the `\b` word boundary in the GitHub-token regex, converting a previously
  detected raw token into a miss

The correct control is in the bug artifact: stop splitting for the *secret* check, match the whole
decoded pathname, collect every decode generation plus the raw form, normalise with NFKC, and keep
`detectCredentialPatterns` per segment so `/mcp` and `/api/v1/mcp` still export.

## Open lows

| ID | Finding | Change |
|---|---|---|
| AGENT-BUNDLE-010 | Export (and now `previewImport`) load every space `AgentSecret` without the owner check the `agentSecrets` APIs use (`router.ts:230-245` vs `apps/api/src/agent-secrets.ts:17-32`). Membership oracle, not disclosure. | surface widened — the oracle is now reachable without owning or exporting a bot |
| AGENT-BUNDLE-011 | Process-wide preview cap lets one actor evict another's valid preview → repeatable commit-denial DoS. | unchanged |
| AGENT-BUNDLE-012 | Public plain-HTTP endpoints pass the schema and import, then fail at runtime (`mcp-transport.ts:75-87`). | unchanged |
| BUG-003-S1-06 | `https://localhost` and friends parse; blocked at the sink. | unchanged |
| BUG-003-S1-08 | `decodeURIComponent("%ZZ")` throws in the export loop with no guard → **HTTP 500** (runtime-confirmed by the checker). Introduced by `f2d4e95f`; the import half of the same commit got this right. | new this run |

Also noted: the cache cap's steady-state maximum is 51 rather than the documented 50, because prune
runs before `Map.set` and only evicts while `size > 50`. Bounded, so cosmetic.

## What the lane got right about `f2d4e95f`

Worth recording, because these were the obvious places to be wrong and are not:

- **No branch scans an uninitialised secret list.** Every parsed bundle loads actor-space secrets
  before scanning and before the cache write. Config/JSON/schema/size failures exit before any scan,
  which is correct.
- **Import placement is right.** The contracts refine has no `context.actor`, so the check cannot
  live there; `previewImport` is the first actor-relative gate and `import` reuses the cached parse.
- **Stale-cache-at-commit is not promoted.** A secret added after preview can make the cached bundle
  stale, but the endpoint bytes were already supplied and reviewed, no new attacker knowledge is
  created, and a later export rechecks. Defence in depth, not a blocker.
- Malformed percent escapes on the import side are already caught and converted to `BAD_REQUEST`.

## Gate honesty

As with every lane in this feature, this is static evidence and satisfies no runtime matrix row. It
substitutes for the unconfigured `gates.ocr_review` adapter under the `001-s1-run1` precedent. The
lane did not pass; the runtime probes it pointed at are what confirmed the medium.
