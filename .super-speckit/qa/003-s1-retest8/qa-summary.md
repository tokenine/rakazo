# S1 Retest 8 — BUG-003-S1-10 (two rounds)

- **Candidates:** `c4d22103` (first fix) → `1d9b82f7` (composition follow-up)
- **Checker:** `omp-checker-003-s1-retest8` — independent
- **Verdict at `1d9b82f7`:** ✅ all known bypasses closed. Awaiting the convergence lane's verdict.

## Round 1 — `c4d22103`

Closed the three bypasses from retest7:

- **decode budget → refusal, not silence.** A segment still carrying a well-formed escape after
  4 passes is refused. `ENDPOINT_MAX` already bounds the work, so the cap never needed to be a CPU
  guard — it needed to be a correctness boundary.
- **per-segment decoding.** One invalid-UTF-8 byte can no longer neutralise its neighbours.
- **two-sided NFKC.** The same normalisation on candidate and secret.

Red at `be20705e`: 4 failed / 75 passed. Green: 79/79 in file, 473/473 api.

## Round 2 — `1d9b82f7` (composition)

The per-segment repair created a new gap (SEC-003-S1-16, found by the lane): decoded segments were
never reassembled, so a secret spanning a `/` whose neighbours are individually encoded matched
nothing.

```
pathname:  /t/opa%71ue/se%63ret
segments:  ["t","opaque","secret"]
any candidate contains "opaque/secret"? false   ← c4d22103
```

Fixed by adding the reassembled whole path (plus its own decode generations) to the candidate set,
built only when every segment decoded cleanly. The same round fixed an over-refusal the first round
introduced: `segmentHasUnresolvedEscape` looked for a bare `%`, so `/files/100%25/mcp` decoded once
to a trailing `%` and was refused. It now looks for a well-formed escape (`%` + two hex digits).

Red at `c4d22103`: 2 failed / 79 passed — the composition case and the encoded-percent guard.
Green: 81/81 in file, 476/476 api, 59/59 contracts, tsc clean, and a new real-Postgres probe
returning 400 for the composition endpoint.

## Gate results at `1d9b82f7`

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | ✅ **476 passed** |
| `@rakazo/contracts` | ✅ 59/59 |
| `tsc --noEmit` | ✅ clean |
| Real-Postgres probes | ✅ all pass, including the new composition probe |
| In-file bundle suite | ✅ 81/81 |

## The invariant, and what it took

> A value held in the space's secret store must never appear, in any representation, of an exported
> or imported MCP endpoint path.

"Any representation" turned out to be the hard part. Five rounds, each closing the case in front of
it:

| Round | Closed | Missed |
|---|---|---|
| `f2d4e95f` | the exact opaque reproducer | `/` in the secret (per-segment matching) |
| `be20705e` | the slash boundary, the 500 | decode budget, decoder poisoning, one-sided NFKC |
| `c4d22103` | those three | the composition of per-segment decoding with a slash-spanning secret |
| `1d9b82f7` | the composition gap, and an over-refusal | — |

The pattern: the control answers "is this string, in some representation, one of these secrets?"
while an attacker chooses the representation. Every bound added to make it decidable was the next
bypass. The durable answer was to enumerate the representation families explicitly and refuse rather
than pass when a bound is reached.

## Standing lows

AGENT-BUNDLE-010 (membership oracle), AGENT-BUNDLE-011 (cache eviction DoS), AGENT-BUNDLE-012
(public HTTP accepted then fails), BUG-003-S1-06 (`https://localhost` parses, blocked at the sink) —
all unchanged and accepted.
