# Plan: 006-cli-agent-chat

## Architecture constraints (project contract)

- The CLI is a thin client over the existing oRPC `/rpc` surface. No new server endpoints (spec amendment required first if one proves necessary). One source of truth for RPC shapes: `@rakazo/contracts` — the CLI keeps using its hand-rolled JSON-RPC client (`apps/cli/src/client.ts`) with zod parsing at the boundary.
- Every command shares one output path: a single `emit()` helper producing the `{ok, data|error}` envelope on stdout, diagnostics on stderr, and the spec's exit codes. No command prints tokens, ever.
- State ownership: credentials live in one file (`~/.config/rakazo/credentials.json`, 0600); env vars override; no other config source.
- Feature stays locally contained in `apps/cli` (+ one packaging field). Dependency direction: cli → contracts (+ zod). Nothing in web/api/desktop/mobile changes.

## Approach

Extend `@rakazo/cli` command switch with: `login`, `logout`, `status`, `computers list`-free `bots` (thread targets are bots — reuse `threads.listSessions`), and `chat`.

`chat` flow: resolve bot → `threads.send` → poll `threads.messages` (`before` cursor from `threads.head`) until an assistant message with `seq > send.seq` appears AND its run reaches a terminal state (run events observable via `threads.get` snapshot status: `waiting_input`, completed) or `--timeout` expires (exit 6). If snapshot reports `waiting_input` or pending MCP approvals, include them in `data` (R4).

## Tasks (ordered, TDD each)

1. `emit()` envelope + exit codes; retrofit existing commands with `--json` (R2, R7). Red: command-layer tests with fake fetch asserting envelope/exit codes.
2. `login/logout/status` + credentials file 0600, env overrides preserved (R5). Red: tests for store/load/redaction.
3. `chat` send + poll reply (R1, R3). Red: fake-fetch tests: reply printed; timeout exits 6; waiting_input surfaced (R4).
4. `bin` field + package metadata so `npm i -g` works (R6); smoke: `npm pack` + install into a temp prefix and run `rakazo --help`.

## Verification

- Unit: vitest fake-fetch suite extended per task (deterministic, offline).
- Journey (Phase gate): real running local stack (compose runbook), login via token, chat with a scripted-runtime bot, assert reply JSON, timeout path, approval surfacing; web UI still functional.
- Engineering review: independent pass on the candidate SHA before merge.

## Risks / unknowns

- Run terminal-state observability via existing snapshot fields — verified during task 3 with a scripted bot; if the snapshot lacks a terminal marker, fall back to assistant-message + idle-window heuristic, documented.
- Consent: if the server rejects send for a fresh principal, surface `aiConsent.status` guidance in the error instead of bypassing.
