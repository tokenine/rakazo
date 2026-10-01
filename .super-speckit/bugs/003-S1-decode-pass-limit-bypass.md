# BUG-003-S1-09 — The 4-pass decode limit lets a secret through 5+ encoding layers

- Status: `confirmed`
- Found in: `003-agent-marketplace / candidate be20705e / QA run 003-s1-retest7, checker probe`
- Severity: `medium` (secret export; same class as BUG-003-S1-07, which this fix was meant to close)
- Runtime-confirmed against real Postgres: `DEEP-ENCODE-STATUS: 200 LEAKS: false` (the *encoded*
  form shipped; decoding it yields the exact secret)

## Expected / actual

**Expected:** BUG-003-S1-07's invariant, restated: *a value held in the space's secret store must
never appear, in any representation, of an exported or imported MCP endpoint path.*

**Actual:** `be20705e` builds candidates by decoding at most `MAX_DECODE_PASSES = 4` times
(`router.ts:621-637`). Each pass removes one encoding layer, so a value encoded 5 or more times is
never reconstructed and the scan finds nothing. Export succeeds and the encoded secret ships in the
bundle.

## Reproduction

Secret stored in the space: `pa%ssword` — chosen because it contains a literal `%`, so encoding it
produces nested escapes. A consumer decoding the shipped path six times recovers the exact value:

```
shipped in bundle: pa%252525252525ssword
recovered by consumer: pa%ssword | matches stored secret: true | decodes needed: 6
```

End to end against real Postgres (secret + `AgentSecret` fixture, endpoint
`https://mcp.example.com/t/pa%252525252525ssword`):

```
DEEP-ENCODE-STATUS: 200 LEAKS: false
```

`LEAKS: false` only means the *literal* string was not present — the encoded form was, and it is
trivially reversible, as shown above. This is a leak.

Layer-by-layer, with the current 4-pass limit:

```
layers=1 leaked=false   layers=4 leaked=false
layers=2 leaked=false   layers=5 leaked=TRUE
layers=3 leaked=false   layers=6 leaked=TRUE
```

Reachability confirmed: `new URL()` preserves the encoded pathname verbatim at every depth tested
(1–6 layers), so the endpoint persists through `McpRemoteEndpointSchema` unchanged.

## Root cause

A decode-pass cap is a heuristic bound placed on an unbounded input. Percent-encoding is
self-similar — `encodeURIComponent` applied n times yields a string that needs exactly n decodes —
so any fixed cap is exceeded by a longer string. The cap exists to stop a CPU-burn attack
(`%25%25%25…`), and that concern is real: `decodeURIComponent` on a long string allocates a new
string each pass, so unbounded passes would be a DoS.

The cap and the correctness requirement are in direct conflict, and the cap won. The fix has to
resolve them differently.

## The correct control

Bound the **work**, not the **depth**, and make the bound an outright rejection rather than a
silent pass:

1. **Reject absurd nesting outright.** If the pathname still contains a `%` after the final allowed
   pass, the endpoint is refusing-worthy: legitimate MCP endpoints do not nest percent-encoding.
   This turns "I could not decode deep enough to decide" into an explicit 4xx instead of a silent
   pass — fail closed, which is the correct default for a secret check.
2. **Size-bound the decode.** `ENDPOINT_MAX` already caps the path length, so each pass is bounded
   by the input size. With a fixed pass count *and* a length cap, total work is bounded — the CPU
   concern does not require unbounded passes.
3. If a residual gap is accepted instead, it must be accepted **explicitly and recorded**, with the
   bound stated (e.g. "at most 4 decoding layers are inspected; deeper nesting is refused
   outright"). Today it is neither bounded nor refused — it silently passes.

Option 1 is the recommendation: it is a few lines, it makes the invariant hold, and it removes the
"unbounded passes" CPU worry that motivated the cap in the first place.

## Regression

- export REFUSES an endpoint whose path still contains `%` after the decode limit
- export REFUSES a 5-layer and a 6-layer encoded stored secret
- export still SUCCEEDS for `/mcp` and `/api/v1/mcp` (no `%` at all — the false-positive guard)
- export still succeeds for a singly-encoded legitimate path
- the existing 1–4 layer cases still refuse (no regression of the working part)
- import REFUSES the same deep-encoded case

Probe: `apps/api/src/qa-retest7-deeplimit.test.ts`
(`.super-speckit/qa/003-s1-retest7/`).
