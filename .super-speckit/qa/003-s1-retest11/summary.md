# Release summary — 003 Agent Marketplace, slice S1

- **Candidate:** `cf909e43`
- **Decision:** **ready, pending the owner's merge call** — one material risk is surfaced below
- **Not merged autonomously**, and the reason is not a gate failure

## Security posture: start → now

| | `3178940e` (first candidate) | `cf909e43` (now) |
|---|---|---|
| Critical | 0 | 0 |
| High | **3** | **0** |
| Medium | 4 | 0 |
| Low | 2 | 4 (all documented, accepted) |

Nine high/medium findings were found and closed across the run, each with a red/green regression
test, and the stored-secret leak class is **confirmed closed by the convergence lane** after seven
rounds: *"For values present in storedSecrets, I could not construct a bypass."*

## Gates at `cf909e43`

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | ✅ 478 passed |
| `@rakazo/contracts` | ✅ 59/59 |
| `tsc --noEmit` | ✅ clean |
| Real-Postgres probes | ✅ 12/13 (the 1 is BUG-003-S1-06, the accepted `https://localhost` low, blocked at the runtime sink) |
| Static security lane | ✅ 0 critical, 0 high, 0 medium |

## The material risk the owner should weigh

The endpoint-path secret control (BUG-003-S1-07 → -10) was rewritten **seven times**:

| Round | Closed | Missed |
|---|---|---|
| `f2d4e95f` | the original reproducer | a `/` inside the secret |
| `be20705e` | the slash boundary, the 500 | decode budget, decoder poisoning, one-sided NFKC |
| `c4d22103` | those three | per-segment decoding vs a slash-spanning secret |
| `1d9b82f7` | the composition gap | two more representation families |
| `ccb1aa01` | those two | mixed depths, fullwidth percent |
| `5f2cf90f` | the whole class (policy) | a pattern-scan regression |
| `cf909e43` | that regression, and the pattern `\b` gap | — |

The final design is a *policy*, not a search: the path is decoded once, and anything that still
carries an escape — or would, under NFKC — is refused. That is decidable, and the simulation matrix
(26 cases, all seven rounds' bypasses plus false-positive guards) passes. But "the enumeration is
over" is a design argument, not a proof, and the seven-round history is the evidence that this
control is easy to believe closed when it is not.

**The decision this surfaces:** is "0 open findings after 7 rounds and a design that removes the
search" sufficient to merge the foundation slice, or should the marketplace wait for either (a) one
more independent lane on `cf909e43`, or (b) a property test over the canonicalisation? Both are
cheap; neither changes the code.

My recommendation is (a) — one more read-only lane before merging, because every previous "closed"
was followed by a finding, and the cost of one more lane is minutes.

## What is in this candidate

Seven bug-fix rounds, each independently retested in a clean worktree against a real Postgres
database:

- token HMAC 500, export secret scan no-op, stdio import RCE, credential inheritance,
  cross-actor preview clobber, atomic refusals, valid audit columns, collection caps,
  stdio/endpoint refusal, pathname credentials, the endpoint-path secret control (7 rounds),
  the pattern boundary fix.

## Standing lows (accepted, documented)

- `AGENT-BUNDLE-010` — export/previewImport load every space secret without the owner check the
  secret APIs use: a membership oracle, not disclosure.
- `AGENT-BUNDLE-011` — the preview cache cap is global, so one actor can evict another's pending
  preview: a commit-denial DoS, no confidentiality impact.
- `AGENT-BUNDLE-012` — a public plain-HTTP endpoint passes import and fails at runtime.
- `BUG-003-S1-06` — `https://localhost` passes the bundle schema; refused at the runtime sink.
