# BUG-003-S1-10 — Endpoint-path secret scan: three residual bypasses at `be20705e`

- Status: `confirmed` (merge-blocking)
- Found in: `003-agent-marketplace / candidate be20705e / QA run 003-s1-retest7, final security lane + checker verification`
- Severity: `medium` ×3
- Affects: `AGENT-BUNDLE-004` / BUG-003-S1-07 — the secret-in-endpoint-path class

`be20705e` closed the slash-boundary bypass (the whole-path `containsSecret` on non-split values is
a real fix) and closed BUG-003-S1-08 (no HTTP 500 remains). The class is **not** closed. Three
independent bypasses remain, all verified by the checker against the actual code.

## Bypass 1 — decoding beyond the 4-pass limit (SEC-003-S1-13)

`buildEndpointPathCandidates` (`router.ts:619-637`) keeps the raw pathname plus at most
`MAX_DECODE_PASSES = 4` decoded generations. Percent-encoding is self-similar, so each layer costs
one pass and any fixed cap is beaten by a longer string.

With a stored secret `pa%ssword` (chosen because it contains a literal `%`, so encoding nests):

```
layers=1 leaked=false   layers=4 leaked=false
layers=2 leaked=false   layers=5 leaked=TRUE
layers=3 leaked=false   layers=6 leaked=TRUE
```

End to end against real Postgres, endpoint `/t/pa%252525252525ssword`:

```
DEEP-ENCODE-STATUS: 200 LEAKS: false
```

`LEAKS: false` only means the literal was absent — the *encoded* form shipped, and it is trivially
reversible: six decodes recover `pa%ssword` exactly. `new URL()` preserves the encoded pathname
verbatim at every depth tested, so the value persists unchanged.

**Fix:** do not silently pass when the limit is hit. After the final allowed pass, if the pathname
still contains `%`, refuse the endpoint (fail closed). Legitimate MCP endpoints do not nest
percent-encoding. This also dissolves the CPU concern that motivated the cap: `ENDPOINT_MAX` already
bounds the path, so a fixed pass count over bounded input is bounded work — the limit was never
needed for that, only for correctness, and correctness needs refusal instead.

## Bypass 2 — invalid-UTF-8 escape poisons the whole-path decoder (SEC-003-S1-14)

`safeDecodeSegment` (`router.ts:599-608`) decodes **the entire pathname** and returns it unchanged on
`URIError`. The API-level guard rejects only `%` not followed by two hex digits
(`router.ts:5233-5244`, `:5613-5623`), so `%FF`, truncated `%E0%A4`, overlong sequences and
surrogate encodings all pass it.

One such byte anywhere in the path makes `decodeURIComponent` throw for the **whole** string, the
candidate builder sees its input unchanged, stops, and no decoded candidate is ever produced:

```
SEC-14 path: /x/%FF/opaque%2Fsecret
  whole-path decode THROWS: URIError -> safeDecodeSegment returns input unchanged
  candidates: ["/x/%FF/opaque%2Fsecret"]
  any candidate contains secret? false
```

A once-encoded secret elsewhere in the path now evades both detectors.

**Fix:** decode **per segment**, not per pathname, and treat an undecodable segment as
"do not decode this one" rather than "do not decode anything". A poisoned segment then cannot
neutralise its neighbours. A segment that cannot be decoded is also refusing-worthy on its own.

## Bypass 3 — one-sided normalisation (SEC-003-S1-15)

`agentSecrets.put` stores `input.value` unchanged and `loadExportSecretValues` returns the plaintext
unchanged (`router.ts:223-246`). Candidates are NFKC-normalised (`router.ts:619-634`); the comparison
uses the raw `secret` (`:671-677`). So folding the candidate but not the secret is inconsistent in
one direction.

Verified with an explicitly NFD secret (`e` + U+0301, confirmed distinct from NFC by codepoint):

```
NFD codepoints: 63 61 66 65 301 5f 73 65 63 72 65 74
NFC codepoints: 63 61 66 65 5f 73 65 63 72 65 74
endpoint pathname: /t/cafe%CC%81_secret
candidates: [raw percent-encoded, decoded-then-folded-to-NFC]
contains raw NFD secret? false
```

**Scope, stated honestly:** the reverse direction is *not* broken. An NFC-stored secret against an
NFD path still matches, because the candidate is folded to NFC. Only the NFD-stored case escapes.
The existing test covers stored-NFC/path-NFD and so misses it.

**Fix:** normalise the secret the same way as the candidate, once, at load or at comparison. One
line, and it makes the two sides agree by construction instead of by coincidence of test coverage.

## Combined invariant

> A value held in the space's secret store must never appear, in any representation, of an exported
> or imported MCP endpoint path. "Any representation" includes encodings deeper than any fixed
> decode budget, paths where one undecodable byte disables decoding for the rest, and every Unicode
> normalisation form of the value.

Each of the three is an independent path to that same leak. Fixing one does not affect the others,
which is why three separate rounds were needed to reach it.

## Regression

- refuse a secret encoded 5 and 6 layers deep
- refuse `/x/%FF/opaque%2Fsecret` with stored secret `opaque/secret` (poisoned-decoder case)
- refuse an NFD-stored secret in an NFD path
- still succeed for `/mcp`, `/api/v1/mcp`, and a legitimately singly-encoded path
- 1–4 layer cases still refuse (no regression of the working part)
- import-side equivalents for each

Probes: `.super-speckit/qa/003-s1-retest7/` (deep-encode), plus the lane's static analysis.
