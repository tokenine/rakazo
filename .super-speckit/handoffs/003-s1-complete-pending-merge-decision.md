# Durable handoff — 003-s1-complete-pending-merge-decision

- **Feature / phase / candidate SHA:** 003-agent-marketplace · S1 · `cf909e43`
- **Lane role:** `checker`
- **Status:** `paused` — work complete, one owner decision outstanding (see below)
- **Transfer:** `same-environment`

## Last verified fact and evidence

At `cf909e43`: 478/478 api, 59/59 contracts, `tsc` clean, 12/13 real-Postgres probes (the 1 is
BUG-003-S1-06, accepted). The security lane reports **0 critical, 0 high, 0 medium, 4 low**, and the
convergence lane confirmed the stored-secret leak class is closed after seven rounds:
*"For values present in storedSecrets, I could not construct a bypass."*

Full summary: `.super-speckit/qa/003-s1-retest11/summary.md`.

## Work completed this session

Recovered a stale state index (git was 7 fix commits ahead of `qa_failed`@`771be989`), completed an
uncommitted fix, provisioned the feature's first live database, closed the first live-DB finding
(BUG-003-S1-09), then ran four fix/retest/lane rounds on the endpoint-path secret control:

| Round | Commit | Closed | Found |
|---|---|---|---|
| 1 | `16c261cf` | preview-cache clobber | — |
| 2 | `61154e37` | credential inheritance (high) | — |
| 3 | `466a8bcf`,`8abb09f5`,`800eb1e4` | 3 mediums | — |
| 4 | `61154e37`→`f2d4e95f` | secret-path (partial) | 500 on malformed escape |
| 5 | `be20705e` | slash bypass, the 500 | 3 representation bypasses |
| 6 | `c4d22103`→`1d9b82f7` | those three | the composition gap; then mixed depths + fullwidth |
| 7 | `5f2cf90f`,`d2e25321`,`cf909e43` | the class (policy) | a pattern-scan regression and its `\b` gap |

## The one decision outstanding

Whether to merge S1 now, or run one more independent lane on `cf909e43` first.

`merge.autonomous_when_ready: true` is set, and every configured gate passes. I did **not** merge,
because the endpoint-path control was rewritten seven times — each round's "closed" was followed by
a finding — and the final design's convergence is a design argument rather than a proof. That
history is material to a merge call on the marketplace foundation, and it belongs to the owner.
Recommendation in the summary: one more read-only lane (minutes) before merging.

## If the decision is "merge"

1. `git merge cf909e43` into `integration/001-multi-session-agents` (S1 stack is linear off `16c261cf`).
2. Transition the feature to `ready_for_merge` → `merged` and record the merge SHA.
3. Reassess the milestone before S2 — the S2 catalog *installs* the bundles this slice hardens.
4. Clean the `ss/bug/003-s1-*` and `ss/qa/003-s1-*` worktrees (evidence is retained under
   `.super-speckit/qa/`, so the worktrees themselves are disposable).

## If the decision is "one more lane"

Dispatch a read-only review of `endpointPathRefuses` + `credential-patterns.ts` at `cf909e43`.
Two cheap strengthenings are available if it finds anything: a property test over
`canonicalForms`/`analyse`, and tightening `McpRemoteEndpointSchema` to reject malformed escapes at
parse time so they are never persisted at all.

## Environment

Node v22.23.3 at `/opt/node-22.23.3` (system v22.22.1 fails `engines`). Postgres container
`ss003pg` on port 55433 is still running and can be removed with
`docker rm -f ss003pg` once no longer needed.
