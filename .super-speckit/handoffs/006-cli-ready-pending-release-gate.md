# Handoff: 006-cli-agent-chat — verified candidate, release gate conflict (2026-10-12)

## State
Candidate 79802574f96d44d3c42159f7567f9544c4f466fb on main (unpushed, local branch `main`;
13 commits; adds only the postbuild exec-bit fix over review-verified 7ccd358b).
Production-verified 2026-10-12 against https://ai7.arisium.xyz (deployed PR #2 build):
chat happy path with the real Chief bot ("CLI test received", exit 0), text mode PONG,
bogus-token override → AUTH_FAILED exit 3, steer live taskId, attach, logout/status.
Test data: new messages in the Chief bot thread of the pilot space; nothing else touched.
Delivery state: retest_running, attempt qa-006-run10 (clone /Users/poom-work/rakazo-qa-006-r10).

## What is verified
- Purpose confirmed by user (chat-only CLI; no direct computer control).
- Live journey QA passed on the running stack (run9 + re-run on run10): chat end-to-end with a bot
  over the offline model fixture ({ok,data} JSON, exit 0), TIMEOUT exit 6, login/logout/status,
  0600 credentials, token never in output, steer/attach live (fixed transport), web UI intact.
- Unit: 26 vitest tests; tsc clean; biome clean.
- Independent engineering review: PASS, no blocking findings (two rounds, second re-verified each fix).

## Blocker (explicit, not a pass)
The kit's strict proof contract requires every non-empty gate in super-speckit.yml. The repo-wide
`playwright: "npx playwright test"` gate is inapplicable: this feature has zero UI surface; the only
playwright suites are desktop (barred locally by AGENTS.md) and mobile. Running it here cannot exit 0
honestly. Weakening the shared gate config is architecture-review territory, so this is surfaced to
the maintainer instead of being quietly satisfied.

## Resume condition
Maintainer chooses: (a) scope the playwright gate to UI-bearing features (config change), then proof
+ ready_for_merge + push/PR proceed; or (b) keep the gate and provide a runnable web e2e that covers
the CLI screen. Candidate SHA is frozen; no further maker work is needed for the current scope.
