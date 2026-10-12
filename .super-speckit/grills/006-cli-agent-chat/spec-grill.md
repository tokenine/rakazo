# Spec Grill: 006-cli-agent-chat (2026-10-12)
Interrogation happened live against the PRD and repo this session; recorded here with resolutions.

1. Direct computer control? User pivoted explicitly: chat only. Computers stay inside the bot's server-side abilities. (Out of scope.)
2. Does the bot's reply text need new backend surface? No — `threads.send` returns run/seq; `threads.messages` pages ThreadMessage with role+blocks (events.ts:348); `threads.head`/`threads.subscribe` exist. CLI polls messages. Zero endpoints.
3. What shape do agents parse? Single `{ok,data|error}` envelope, exit codes 0/1/2/3/6; documented in --help and spec R2.
4. What if the bot parks on a question/approval? Surface `waiting_input`/pending approvals in chat output (R4); answering uses existing steer/approve/deny.
5. Token lifetime? better-auth default ~7d, no custom session config; acceptable v1, API keys deferred (non-goal). Limitation recorded.
6. Consent gate? Standalone aiConsent.status/allow; no inline gate on threads.send (existing CLI steer sends today). Red/green test during implementation verifies.
7. Distribution? npm global via new `bin` field; Node required on target machine (user chose option 1).
8. Streaming vs polling? Poll `threads.messages` bounded by --timeout; subscribe kept as implementation option if polling proves awkward. Decision: polling first, simplest proven seam.
