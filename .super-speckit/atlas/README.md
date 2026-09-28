# Project Atlas

This is a diagram-first, evidence-linked map of the codebase. It is a guide, not execution authority. Each statement links to a path, command result, or explicit unknown.

## Update rule

Update only the affected component cards after a verified change. Preserve unknowns rather than inventing architecture.

## System shape

One product (Rakazo) across three surfaces — web, desktop (Electron hosts the web UI), and mobile (Expo Router) — over shared packages for contracts, domain logic, data, and provider adapters. Layout verified from workspace manifests (2026-09-28).

## Entry points

| Card | Path | Evidence |
| --- | --- | --- |
| Web app | `apps/web` (`@rakazo/web`) | `apps/web/package.json` |
| Desktop shell | `apps/desktop` (`@rakazo/desktop`), Electron host for the web UI | `apps/desktop/package.json`, repo AGENTS.md |
| Mobile app | `apps/mobile` (`@rakazo/mobile`), Expo Router, native-first | `apps/mobile/package.json`, repo AGENTS.md |
| API server | `apps/api` (`@rakazo/api`), runs `src/index.ts` via tsx | `apps/api/package.json` scripts |
| Worker | `apps/worker` (`@rakazo/worker`), runs `src/index.ts` via tsx | `apps/worker/package.json` scripts |
| Marketing site | `apps/www` (`@rakazo/www`) | `apps/www/package.json` |

## Components

| Card | Path | Claims | Evidence |
| --- | --- | --- | --- |
| Data + events | `packages/db` | Prisma schema (`Thread.botId @unique` at `prisma/schema.prisma:473`; group/external uniques at :475/:477) and event plumbing incl. `sendUserMessage` busy guard filtered on `(threadId, botId)` (~`src/events.ts:378-388`) | `packages/db/prisma/schema.prisma`, `packages/db/src/events.ts`, `specs/001-multi-session-agents/spec.md` (Q1 research) |
| Contracts | `packages/contracts` | Shared API contracts between surfaces and services | repo AGENTS.md; per-file claims unknown |
| Domain core | `packages/core` | Shared domain logic | per-file claims unknown |
| Provider adapters | `packages/adapters` | Run executor (`src/executor.ts:1103-1124` — run leases key on run id) and computer lifecycle (`src/computer-lifecycle.ts:439-505` — `ComputerExecutionLease` unique on `(computerId, botId)`; second concurrent run gets `ComputerBusyError`, requeues with backoff) | `packages/adapters/src/executor.ts`, `packages/adapters/src/computer-lifecycle.ts` |
| Thread resolution | `apps/api/src/thread-target.ts` | `resolveThreadTarget` (:268-303) maps `{botId \| groupId}` → one thread for all 12 `threads/*` RPCs (`router.ts:1550-1792`); unread state setter (:1129-1135) owner-scoped | `apps/api/src/thread-target.ts`, `apps/api/src/router.ts` |
| Messaging inbound | `apps/api/src/messaging-inbound.ts` | Telegram/peer inbound routes via `thread.findFirst({ botId })` (:124, :690, :740) — must become primary-session lookups under multi-session | `apps/api/src/messaging-inbound.ts` |
| Adapter kit | `packages/adapter-kit` | role unknown | — |
| Auth | `packages/auth` | role unknown | — |
| Memory | `packages/memory` | role unknown | — |
| Chat UI | `packages/chat-ui` | reusable chat surfaces (thread/composer/avatars) | repo AGENTS.md; per-file claims unknown |
| Web UI kit | `packages/ui-web` | shadcn/ui on Base UI, vendored | repo AGENTS.md |
| Design tokens | `packages/ui-tokens` | semantic tokens, one TS source generates `tokens.css` | repo AGENTS.md |
| Test kit | `packages/testkit` | shared deterministic/offline test helpers | repo AGENTS.md; per-file claims unknown |
| Logging | `packages/logging` | role unknown | — |

## External boundaries

| Boundary | Where | Evidence |
| --- | --- | --- |
| Database (Prisma) | `packages/db/prisma/schema.prisma` | file exists |
| Bot computers | `packages/adapters/src/computer-lifecycle.ts` (per-bot execution lease) | `:439-505` |
| Messaging (Telegram) inbound routing | `packages/db/src/events.ts` busy guard `(threadId, botId)`; exact dispatch chain to sessions unknown | `~378-388` via `specs/001-multi-session-agents/spec.md` Q1 |
| LLM / sandboxes / voice / integrations | provider-neutral adapters; SDKs confined to adapter/composition layers | repo AGENTS.md |

## Evidence

- Structure claims verified 2026-09-28 against workspace manifests and the cited file paths.
- Runtime/test evidence lives in `.super-speckit/qa/` (currently empty) and `specs/<feature>/verification-matrix.md`.
