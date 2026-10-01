# S1 Retest 7 — BUG-003-S1-07 second attempt (`be20705e`)

- **Candidate under test:** `be20705e` (whole-path scan, on top of `f2d4e95f`)
- **Checker:** `omp-checker-003-s1-retest7` — independent
- **Verdict:** ❌ **NOT MERGE-READY.** The slash bypass and the 500 are closed; three new medium
  bypasses found, one by the checker and two confirmed by it.

## Gate results

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | ✅ 468 passed |
| `@rakazo/contracts` | ✅ 59/59 |
| `tsc --noEmit` | ✅ clean |
| All carried-over real-Postgres reproducers | ✅ green — opaque secret, slash secret, malformed escape |
| Final security lane | ❌ NO-GO, 3 medium |

## What this fix got right

The slash-boundary bypass is genuinely closed: `containsSecret` now runs on the whole candidate
without splitting, on both export and import, through one shared helper. BUG-003-S1-08 (the 500) is
closed — no unguarded `decodeURIComponent` remains. The decode-removes-match case is closed by
always including the raw form.

## What is still open → BUG-003-S1-10

Three independent bypasses, all verified against the code (two also at runtime):

1. **Decode budget (SEC-003-S1-13)** — `MAX_DECODE_PASSES = 4` is a cap on self-similar input.
   Runtime-confirmed: a secret encoded 6 layers deep exported with **HTTP 200**, and the shipped
   form decodes in 6 steps to the exact stored value. `LEAKS: false` was misleading — the *encoded*
   form leaked.
2. **Decoder poisoning (SEC-003-S1-14)** — `decodeURIComponent` ran on the whole pathname, so one
   `%FF` threw for the entire string and the candidate set contained only the raw form. A
   once-encoded secret elsewhere in the path evaded both detectors.
3. **One-sided normalisation (SEC-003-S1-15)** — candidates were NFKC-folded, secrets were compared
   raw. An NFD-stored secret in an NFD path escaped. (The reverse direction is fine; only NFD-stored
   escapes.)

Fix: `ss/bug/003-s1-10` → `c4d22103`, retested in `003-s1-retest8`.

---

# S1 Retest 8 — BUG-003-S1-10 fix (`c4d22103`)

- **Candidate under test:** `c4d22103`
- **Checker:** `omp-checker-003-s1-retest8` — independent
- **Verdict:** ✅ **all known secret-path bypasses closed.** Awaiting the final security lane.

## Gate results

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | ✅ **473 passed / 489** (16 DB-gated, run separately) |
| `@rakazo/contracts` | ✅ 59/59 |
| `tsc --noEmit` | ✅ clean |
| Real-Postgres probes (9) | ✅ **9/9** — deep-encode, slash secret, opaque secret, malformed escape, and all earlier closures |
| In-file bundle suite | ✅ 79/79 (6 new tests) |

## Red → green

Red at `be20705e` with the new tests in place: **4 failed / 75 passed** — exactly the bypass cases
(5-layer, 6-layer, poisoned decoder, NFD-stored), while the two false-positive guards passed there
too. Green at `c4d22103`: all 6 pass.

## The control, and why it is shaped this way

- **Decode budget → refusal, not silence.** A segment still carrying `%` after 4 passes is refused.
  Legitimate MCP endpoints do not nest percent-encoding, and `ENDPOINT_MAX` already bounds the work,
  so the cap never needed to be a CPU guard — it needed to be a correctness boundary. Failing closed
  is free.
- **Per-segment decoding.** One undecodable byte can no longer neutralise its neighbours, and an
  undecodable segment is refused on its own.
- **Two-sided NFKC.** The same normalisation is applied to the candidate and to the secret, so the
  comparison is consistent by construction rather than by test coverage.
- **One shared helper** on both export and import. The two halves of `f2d4e95f` had already drifted
  once; the helper is the structural guarantee against a third.

False-positive guards: `/mcp`, `/api/v1/mcp`, and a plain singly-encoded path all still export.

## Open at this tip

The four accepted lows (AGENT-BUNDLE-010/011/012 and BUG-003-S1-06), unchanged. The final security
lane at `c4d22103` is the remaining gate before the merge decision.
