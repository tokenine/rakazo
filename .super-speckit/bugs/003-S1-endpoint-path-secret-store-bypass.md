# BUG-003-S1-07 — Export leaks a stored secret through an MCP endpoint path

- Status: `confirmed` (blocks S1 release)
- Found in: `003-agent-marketplace / candidate 800eb1e4 / QA run 003-s1-retest5, final security lane (AGENT-BUNDLE-004 residual) + checker runtime proof**
- Affected requirement: `R1` — matrix row **V1** ("export REFUSED listing fields" / no secret leaves the system)
- Severity: `medium`
- Regression: runtime-confirmed against real Postgres — export returned **200** and the stored secret value appeared verbatim in the exported bundle

## Expected / actual

**Expected:** export refuses when any field it would serialize contains a value the space holds in
its secret store. This obligation already exists and works for free text: the export path loads the
space's `AgentSecret` values and runs `containsSecret` over bot and skill text, naming the offending
field on refusal.

**Actual:** the endpoint-path check added in `8abb09f5` runs **only** `detectCredentialPatterns()`
against each `URL.pathname` segment. It never consults the already-loaded `storedSecrets`. A secret
with no recognizable provider prefix — which is the entire reason the stored-secret scan exists —
passes through and is written into the portable bundle.

## Runtime proof

Fixture: a real `AgentSecret` + backing `Secret` whose plaintext is
`Zk8vQ2xLm9TbR4pWy7NcH3` (no provider prefix, so no pattern matches), and an `McpServer` whose
endpoint is `https://mcp.example.com/t/Zk8vQ2xLm9TbR4pWy7NcH3`, assigned to a bot.

Result:

```
EXPORT-STATUS: 200 LEAKS-SECRET: true
```

Export **succeeds** and the response body contains the secret value. The bundle is then shareable,
and the credential travels with it.

Probe: `apps/api/src/qa-retest5-004gap.test.ts` (throwaway checker artifact,
`.super-speckit/qa/003-s1-retest5/`).

## Root cause

`apps/api/src/router.ts`, `agents.export`, the MCP endpoint loop (`~5464-5491`):

```ts
if (url.username || url.password || url.search) { /* refuse */ }
const pathSegments = url.pathname.split("/").filter(Boolean);
for (const segment of pathSegments) {
  if (detectCredentialPatterns(segment).length > 0) { /* refuse */ }
}
```

Two different detectors exist in this file, and this loop uses only the narrow one:

- `containsSecret(value, storedSecrets)` — known-secret substring match, catches **any** value the
  space actually stores. This is what caught `bot.instructions` in BUG-003-S1-02's fix.
- `detectCredentialPatterns(text)` — high-confidence provider prefixes (`sk-`, `ghp_`, `AKIA`, …).
  Deliberately narrow, per its own comment: *"A general 'looks random' heuristic is deliberately
  absent — false positives here block a legitimate export."*

`/token/ghp_ABC…` is caught. `/token/Zk8vQ2xLm9TbR4pWy7NcH3` is not. A user's own API key, pasted
into their MCP endpoint path, is exactly the case the spec's V1 row names.

Two smaller holes in the same loop, both confirmed by the lane:

- **No percent-decoding.** `ghp%5F…` decodes to `ghp_…` at request time, so a reversibly encoded
  provider token evades the segment regex entirely.
- **The stored-secret scan is not applied to the endpoint at all**, which is the finding above.

## Fix

Apply **both** detectors to the path, plus percent-decoding:

```ts
for (const raw of pathSegments) {
  const segment = safeDecode(raw);
  if (detectCredentialPatterns(segment).length > 0) { /* refuse */ }
  if (containsSecret(segment, storedSecrets)) { /* refuse */ }
}
```

`storedSecrets` is already in scope in this handler (it backs the free-text scan), so this is a
small change rather than a new mechanism. The same treatment belongs on the `url.search` /
`url.username` / `url.password` branch for consistency, and — per `AGENT-BUNDLE-005` — on **import**,
where a bundle endpoint is validated at parse time in `packages/contracts/src/agent-bundle.ts`. A
bundle carrying `https://host/t/<the-victim's-own-stored-secret>` is the inbound direction of the
same leak and is currently unchecked.

**Invariant, covering both directions:**

> A value held in the space's secret store must never appear in an exported bundle, and must never
> arrive in one.

## Regression

- export refuses when the endpoint path contains a value in the secret store (the probe above; it is
  red at `800eb1e4`)
- export refuses a percent-encoded provider token in the path
- export still succeeds for `/mcp` and `/api/v1/mcp` (the false-positive case — a blanket
  "any non-trivial path" rule would break this and is explicitly not the chosen control)
- import refuses a bundle whose endpoint contains a stored secret

---

# Update — `f2d4e95f` did not close this as a class

The fix applied `containsSecret(segment, storedSecrets)` to **per-segment, once-decoded** values
(`router.ts:5519-5522` export, `:5141-5145` import). That blocks the original opaque reproducer and
a once-encoded `ghp%5F…`, but the leak is still reachable. Two independent bypasses, both
runtime-confirmed:

## Bypass 1 — a secret containing `/` (runtime-confirmed)

`AgentSecretInputSchema` accepts any value 1–16384 characters (`packages/contracts/src/domain.ts:37-40`),
including slashes. The loop splits the pathname *before* matching, so a secret spanning a segment
boundary never matches any single segment:

```
secret stored as: "opaque/secret"
pathname:         /t/opaque/secret
segments scanned: ["t","opaque","secret"]
any segment contains whole secret? false
full pathname contains whole secret? true
```

End to end against real Postgres, with `Zk8v…`-style opaque value replaced by `opaque/secret`:

```
EXPORT-STATUS: 200 LEAKS-SECRET: true
```

Probe: `apps/api/src/qa-retest7-slashsecret.test.ts`.

## Bypass 2 — nested encoding and canonical equivalence

- **Double encoding:** a secret character written `%25` decodes once to `%`, so a second decode is
  needed to recover the original. One pass is not enough.
- **Unicode canonical equivalence:** a secret stored in NFC will not substring-match the same text
  in NFD. No normalisation is applied on either side.
- **Decode can *remove* a match:** `ghp_<token>%5F` decodes to `ghp_<token>_`, and the trailing
  underscore defeats the `\b` word boundary in the GitHub-token regex. Checking only the decoded
  form turns a previously-detectable raw token into a miss.

## The correct control

**Stop splitting.** Match against representations of the **whole** decoded pathname, not of
individual segments. Concretely, for each endpoint:

```ts
const raw = url.pathname;
const decoded = safeDecodeAll(raw);        // repeat decode until stable, max N passes
for (const candidate of new Set([raw, decoded, safeDecodeAll(decoded)])) {
  if (containsSecret(candidate, storedSecrets)) refuse;   // ← whole-string, not per segment
  for (const seg of candidate.split("/")) {
    if (detectCredentialPatterns(seg).length > 0) refuse; // patterns are per-segment by design
  }
}
```

- `containsSecret` on the **whole** path is what closes Bypass 1: `/t/opaque/secret` contains
  `opaque/secret` as a substring.
- Repeated decode (bounded, with a fixed pass limit to stop `%25%25…` games) closes Bypass 2's
  nested-encoding half.
- Normalise both sides with `.normalize("NFKC")` before comparing.
- `detectCredentialPatterns` stays per-segment, because its patterns are prefix-anchored and
  segment-scoped matching is what makes `/mcp` and `/api/v1/mcp` pass. Matching the whole path with
  it would be fine too and is worth considering for consistency.

`safeDecode` must be failure-safe (`decodeURIComponent("%ZZ")` throws `URIError` — see
BUG-003-S1-08, which is the same unguarded call on the export side).

**Invariant restated:** a value held in the space's secret store must never appear in any
representation of an exported or imported endpoint path. "Any representation" is the part
`f2d4e95f` missed.

