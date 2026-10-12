# BUG-003-S1-08 — Export returns HTTP 500 for an MCP endpoint with a malformed percent-escape

- Status: `confirmed`
- Found in: `003-agent-marketplace / candidate f2d4e95f / QA run 003-s1-retest6, checker probe`
- Introduced by: `f2d4e95f` (the BUG-003-S1-07 fix)
- Severity: `low` (availability — a 500 instead of a 4xx; no disclosure, no data loss)
- Runtime-confirmed against real Postgres: `ESCAPE-EXPORT-STATUS: 500`

## Expected / actual

**Expected:** the commit's own comment states the contract — *"A malformed percent-escape is treated
as a literal segment and left for the detectors."* A malformed escape is client-supplied input, so
the correct outcome is a clean 4xx (or the segment being scanned literally), never an unhandled
exception surfaced as 500.

**Actual:** `decodeURIComponent("%ZZ")` throws `URIError: URI malformed`, and the export path loop
has no `try`/`catch` around it. The exception escapes the handler and becomes
`INTERNAL_SERVER_ERROR`.

## Reachability

`McpRemoteEndpointSchema` (`packages/contracts/src/mcp.ts:15-30`) validates the endpoint with
`z.string().url()`, which parses the URL but does **not** validate percent-escape syntax inside the
path. Verified:

```
SCHEMA ACCEPTS https://mcp.example.com/t/%ZZ
SCHEMA ACCEPTS https://mcp.example.com/t/%E0%A4%A
SCHEMA ACCEPTS https://mcp.example.com/t/%
```

So the value is accepted by `mcp.servers.create` / `mcp.servers.update`
(`packages/contracts/src/domain.ts:706,712`), persisted to `McpServer.endpoint`, assigned to a bot,
and then every subsequent `agents.export` of that bot returns 500.

This is the same shape as **BUG-003-S1-01** (a malformed token producing HTTP 500 rather than a
4xx), on a different input.

## Root cause

`apps/api/src/router.ts`, `agents.export` endpoint loop (`~5515-5527`):

```ts
for (const raw of pathSegments) {
  const segment = decodeURIComponent(raw);   // throws URIError on %ZZ
  if (detectCredentialPatterns(segment).length > 0 || containsSecret(segment, storedSecrets)) { … }
}
```

The fix added percent-decoding to catch `ghp%5F…` and did not add a failure mode for malformed
input. Note the **import** side of the same commit got this right — it wraps the loop in
`try`/`catch` and rethrows `ORPCError` unchanged (`router.ts:5142-5162`). Only the export side is
unguarded, so the two halves of one commit disagree.

## Fix

Extract a small failure-safe decoder and use it on both sides, so the behaviour is identical and the
comment is true:

```ts
function safeDecodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // malformed escape: treat literally and let the detectors decide
  }
}
```

Then `const segment = safeDecodeSegment(raw);` in the export loop. The import side may use the same
helper and keep its existing outer `try`/`catch` for the `new URL()` failure.

**Prefer fixing this in the schema too** if that is cheap: rejecting endpoints with a malformed
percent-escape at `McpRemoteEndpointSchema` stops the value being persisted at all, which is the
better place for malformed-URL rejection. That is a judgement call — the API-layer guard is the
minimum, the schema refinement prevents the state entirely.

## Regression

- `agents/export` with an endpoint `https://host/t/%ZZ` returns 400, not 500
- `agents/export` with `%E0%A4%A` and with a bare `%` likewise
- `agents/export` with `/mcp` and `/api/v1/mcp` still succeeds
- the BUG-003-S1-07 cases still refuse (stored secret, percent-encoded `ghp_`)

Probes: `qa-retest6-decode.test.ts` (schema reachability) and `qa-retest6-decode500.test.ts`
(runtime 500), both under `.super-speckit/qa/003-s1-retest6/`.
