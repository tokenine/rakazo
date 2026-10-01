# S1 Retest 9 + 10 — the convergence rounds

- **Candidates:** `ccb1aa01` (systematic closure, retest9) → `1d9b82f7` → `5f2cf90f` (policy, retest10)
- **Checker:** `omp-checker-003-s1-retest9/10` — independent
- **Verdict at `5f2cf90f`:** ✅ awaiting final adjudication

This is the pair of rounds where the control stopped being a list of cases and became a policy.

## Round 6 — `ccb1aa01`, the systematic closure

The convergence lane had identified the structural flaw precisely: the candidate set was built by
enumerating *families*, and it named the two missing ones (intermediate whole-path decode
generations; the `allDecoded` gate suppressing reassembly). `ccb1aa01` rebuilt the set as a closure
over decode depth — per-segment ladders, every rung a candidate, synchronized joins at every depth.

It closed SEC-003-S1-17 and SEC-003-S1-18. It did not converge: the lane constructed SEC-003-S1-19
(independent per-segment depths — `/foo%2525/bar%2562az` with secret `foo%25/barbaz` needs depth 1
on one side and depth 2 on the other, which no synchronized join produces) and SEC-003-S1-20 (NFKC
turning fullwidth percent `％73` into a real escape `%73`, which the builder never decoded because
`decodeURIComponent` saw no ASCII `%`).

## The decision point

Six rounds in, two facts were clear:

1. The representation space is **unbounded** — percent-encoding is self-similar, normalisation
   creates new escapes, and each segment can sit at its own depth. No finite enumeration closes it.
2. The config's `max_repair_cycles: 3` had been exceeded four times over on one 40-line function.

Per the autonomous-execution policy ("at the configured repair limit … select a different bounded
approach"), the control changed shape rather than being extended again.

## Round 7 — `5f2cf90f`, the policy

The new rule: **decode the path once. If that leaves a well-formed escape — or if NFKC would
synthesise one — refuse.**

Decoding once is not arbitrary: a URL path is percent-encoded exactly once, and decoding it again
is decoding *data*, not a path. So nothing a second decode reveals is a representation of this path,
and refusing it costs nothing real. Three things are refused:

- undecodable input (`%ZZ`, `%FF` → invalid UTF-8);
- a well-formed escape surviving the decode — which is where deep nesting, mixed per-segment
  depths, and encoded slashes between segments all land;
- NFKC *synthesising* an escape (fullwidth `％73` → `%73`) — and only the synthesised case, which is
  what keeps `%20`, `%C3%A9` and a literal `100%25` working.

What survives is a path with no escapes at all, so the representation set is exactly four strings
(raw, decoded, and their NFKC forms) and the secret match runs over those. The set is closed because
the policy removed the operations that generated the unbounded space — not because the enumeration
got better.

**Verified in simulation over 26 cases**: every bypass from all seven rounds is refused, and the
false-positive guards hold (`/mcp`, `/api/v1/mcp`, `%20`, `%C3%A9`, `100%25`, `~user`).

## Gate results at `5f2cf90f`

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | ✅ **477 passed** |
| `@rakazo/contracts` | ✅ 59/59 |
| `tsc --noEmit` | ✅ clean |
| In-file bundle suite | ✅ 83/83 |
| Real-Postgres probes (all prior rounds) | ✅ 15/15 substantive; the 2 failures are the known throwaway schema diagnostic and BUG-003-S1-06 |

## Open

The four accepted lows, unchanged. Final adjudication lane dispatched.
