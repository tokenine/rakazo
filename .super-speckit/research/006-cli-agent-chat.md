# Research: 006-cli-agent-chat (verified against repo, 2026-10-12)

## Q1 Can the CLI read the bot's reply without backend changes? — YES
- `threads.send` (packages/contracts/src/rpc.ts:356) returns {taskId, runId, seq}.
- `threads.messages` (rpc.ts:338) pages ThreadMessage (id, seq, role, blocks[]) — packages/contracts/src/events.ts:348. Assistant reply = later message with role=bot/assistant and text blocks.
- `threads.head` cursor (rpc.ts:331) + `threads.subscribe` eventIterator (rpc.ts:353) available for live waits; polling `threads.messages` is the simplest proven path (existing `attach` reads thread state the same way).
## Q2 Token lifetime — better-auth default
- packages/auth/src/index.ts has no custom session expiry (only OTP expiresIn 60*10); better-auth default ~7 days refreshed. Bearer tokens via bearer() plugin work over the sessionHeaders path (apps/api/src/app.ts:1050). Limitation: token expires ~weekly; scoped API keys deferred (spec non-goal).
## Q3 AI consent gate
- Consent is a standalone procedure group `aiConsent.status/allow/revoke` (apps/api/src/router.ts:914-931); no inline gate found on threads.send — the existing CLI `steer` already sends successfully. CLI will surface consent status if the server reports it as required. Verify with a red/green test during implementation.
## Distribution
- apps/cli is in the pnpm workspace but has no `bin` field (apps/cli/package.json) — add it; npm i -g works via workspace publish flow. Target machine needs only Node.
