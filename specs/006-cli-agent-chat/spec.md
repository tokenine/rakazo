# Spec: 006-cli-agent-chat — Agent-usable CLI chat with a Rakazo bot

## Why

AI coding agents (Pi, OMP, ZCode) run on a machine separate from the Rakazo server. They can already reach the server over HTTPS; what they lack is a way to hold a conversation with a Rakazo bot — send a prompt, read the bot's answer back — from a shell, in machine-readable form. The web UI serves humans; the agent needs the same conversation as a command.

The existing `apps/cli` (`@rakazo/cli`) already sends messages (`steer`) and snapshots thread state (`attach`), but no command returns the bot's reply, and no command emits JSON an agent can parse. This feature closes that gap.

## Confirmed purpose (provenance)

User, this session: "i don't ask for direct use of computer i just want way to communicate with the bot … like normal chat but just from cli that let the bot answer back via cli so my agent can use and read it" — then confirmed the revised chat-loop change story ("yes it is that what i want. continue"). Direct computer-control commands are explicitly out of scope.

## Requirements

- REQ-1 `rakazo chat <bot-id> "<message>"` sends the message to the bot's thread, waits for the bot's turn to finish, and prints the bot's reply text.
- REQ-2 Every command supports `--json`: envelope `{ok: true, data: …}` on success, `{ok: false, error: {code, message, retryable}}` on failure; exit codes 0 success / 1 general / 2 usage / 3 auth / 6 timeout; stdout machine-readable, stderr diagnostics.
- REQ-3 `chat` respects a `--timeout` (default bounded, e.g. 120s) and exits 6 with a structured error instead of hanging.
- REQ-4 If the bot parks on a question or approval (`waiting_input` / pending MCP approval), the reply/JSON exposes that state so the calling agent can answer it (via `steer`/`approve`/`deny`, already implemented).
- REQ-5 `rakazo login --server <url>` exchanges credentials for a token and stores it with 0600 perms under the user config dir; `logout` removes it; `status` reports the configured server and auth state without leaking the token. Env overrides (`RAKAZO_TOKEN`, `RAKAZO_BASE_URL`) keep working for CI/agent use.
- REQ-6 The package installs as a global command: `bin` entry so `npm i -g @rakazo/cli` provides `rakazo`. No repo checkout needed on the target machine.
- REQ-7 Tokens never appear in logs, JSON output, or error messages.

## Non-goals (this feature)

- Direct computer-control commands (screenshot/click/type) — possible later phase.
- New server endpoints beyond what investigation shows exists (`threads.send`, `threads.subscribe`, `threads.get`, `mcp.assignments.*`). If spec-phase verification shows the bot's final answer text is not observable via existing RPC, that single small gap becomes an explicit amendment before implementation.
- Long-lived scoped API keys — session/bearer tokens are accepted for v1; expiry behavior is verified in plan phase and revisited only if it breaks the chat loop.
- SKILL.md for agents (later phase), streaming/interactive REPL mode.

## Acceptance

- From a directory with no repo checkout, `npm i -g @rakazo/cli`, configure server + token, and: `chat` returns the bot's reply; `--json` parses and has the documented envelope; a nonresponsive bot hits the timeout with exit 6 and structured error; a pending approval surfaces in chat output; `status`/`login`/`logout` round-trip without printing the token; existing `attach`/`steer`/`approve`/`deny` commands keep working and gain `--json` without behavior change.
- Server-side: no changes, or only the one amendment above; web UI unaffected.

## Evidence base

- Existing CLI: `apps/cli/src/index.ts` (commands, argv parsing), `apps/cli/src/client.ts` (bearer auth, JSON-RPC over HTTP to `/rpc`, methods `threads.listSessions/get/send`, `mcp.assignments.*`), tests in `apps/cli/src/client.test.ts`.
- Server surface: `apps/api/src/app.ts:563-616` (oRPC at `/rpc`), `apps/api/src/app.ts:1050-1056` (bearer→session header), `packages/contracts/src/rpc.ts` (`threads.send` ~356, `threads.subscribe` eventIterator, `computer.*`), `apps/api/src/router.ts` (thread handlers).
- Unknown to resolve in plan: exact shape of subscribe events carrying the assistant's final text; token TTL; whether `threads.send` from a CLI principal requires AI-consent gating (`packages/core/src/ai-consent.ts`) and how the web UI satisfies it today.
