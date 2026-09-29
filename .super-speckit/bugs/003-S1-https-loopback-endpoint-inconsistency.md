# BUG-003-S1-06 — `https://localhost` bundle endpoints pass schema validation

- Status: `confirmed` — **defence-in-depth only, not a live vulnerability**
- Found in: `003-agent-marketplace / candidate 800eb1e4 / QA run 003-s1-retest5, checker probe`
- Affected requirement: `R4` — matrix row **V2** (SSRF variant)
- Severity: `low` (informational / consistency)
- Related: AGENT-BUNDLE-005, fixed by `466a8bcf`

## Expected / actual

**Expected:** the `AGENT-BUNDLE-005` fix rejects non-public MCP endpoints at parse time. Its own
comment states the intent: *"rejects loopback, link-local, and non-HTTP(S) schemes before the bundle
is ever persisted"*, and lists `127.0.0.0/8` and `::1` without qualifying them by protocol.

**Actual:** the guard applies `isLocalMcpHost()` only inside the `url.protocol === "http:"` branch,
so `https://localhost/mcp`, `https://127.0.0.1/mcp` and `https://[::1]/mcp` all pass
`AgentBundleMcpServerSchema`.

## Is it exploitable? No

Verified directly against the runtime sink with an injected resolver (nothing is contacted):

```
BLOCKED  https://localhost/mcp  -> Connector URL targets a private host
BLOCKED  https://127.0.0.1/mcp  -> Connector URL targets a private host
BLOCKED  https://[::1]/mcp      -> Connector URL targets a private host
BLOCKED  https://169.254.169.254/latest/meta-data -> Connector URL targets a private host
BLOCKED  http://localhost:3000/mcp -> Connector URL must use HTTPS
ALLOWED  https://example.com/mcp
```

`assertSafeRemoteUrl` → `inspectSafeRemoteUrl` (`packages/adapters/src/remote-mcp.ts:127-145`)
applies `isPrivateHostname` after the HTTPS check, with no protocol condition on the private-host
branch. So an `https://localhost` bundle endpoint parses, persists, and is then refused at connect
time before any socket opens.

**The control that actually stops this is the sink, not the bundle schema.** The schema gap is real
but is the second line, not the first.

## Why it still matters

1. The failure moves to runtime, where it surfaces as a per-run MCP error rather than a clear
   "this bundle cannot be imported" refusal. A user importing a bundle with a loopback endpoint gets
   a broken agent and a confusing error instead of a 4xx at the boundary.
2. The comment and the code disagree, which is how the next reader re-introduces the bug by
   "simplifying" the branch. That already happened once: `6b5509b3` closed the endpoint-mismatch
   variant and left 001 open in the same seam.
3. If `isPrivateHostname` is ever relaxed, the schema is the layer that should still hold.

## Fix

Move the local/loopback/private-host rejection out of the `http:`-only branch so it applies to both
schemes, and reuse the same private-host notion the sink uses rather than the narrower
`isLocalMcpHost`. In `packages/contracts/src/agent-bundle.ts`, `AgentBundleMcpServerSchema.endpoint`:

```ts
.refine((value) => {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.protocol === "http:") return false;        // bundles must be HTTPS
  return !isPrivateMcpHost(url.hostname);            // loopback/link-local/private, any scheme
}, { message: "Endpoint must be a public HTTPS URL" });
```

Note this also tightens the rule: the current fix accepts **public** `http://` endpoints, while the
sink rejects every non-HTTPS URL outright (`Connector URL must use HTTPS`). So a bundle with a
public `http://` endpoint also passes schema and fails at runtime. Bundles should be HTTPS-only.

## Regression

Extend the checker's probe list to cover `https://localhost`, `https://127.0.0.1`,
`https://[::1]`, and a public `http://` endpoint, asserting all are rejected at the schema. That
probe (`qa-retest5-mediumcontrols.test.ts`, case 1 of 7) is the one currently red at `800eb1e4`.
