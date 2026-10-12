# Feature 001 — Multi-session agents

Status: specified · clarifications pending before plan
Priority: 1 of 3 (user-ordered)
Base commit: d7a4e523 (atlas base)

## Problem

Today a bot has exactly one thread: `Thread.botId @unique` (packages/db/prisma/schema.prisma:473).
A user working several tasks with the same agent mixes context across those tasks, and
compaction (historyCompactedUpToSeq) permanently reshapes the single shared history. Users
need parallel, separately-contexted conversations with the same agent, each resumable later.

## Requirements

1. R1 — The bot's owner can open any number of named sessions (threads) with the same bot in a space. (Sessions are owner-scoped like all bot-thread operations today; space-member sharing is out of scope for v1 — grill resolution.)
2. R2 — Each session keeps its own message history, compaction state, run serialization, and unread flag; runs in different sessions of one bot must not block each other except where a shared resource (the bot's computer lease) genuinely serializes them.
3. R3 — The user can list, switch between, rename, and delete a bot's sessions; last-activity ordering.
4. R4 — A session is resumable later on any surface (web, desktop, mobile) with its full available history (compaction summary + post-compaction tail, matching existing compaction semantics).
5. R5 — Messaging (Telegram) keeps working: inbound routing must land on the correct session (default: the bot's primary session) — no regression to existing single-thread behavior.
6. R6 — Existing deployments migrate without data loss: current bot threads become the bot's primary session.

## Non-goals

- Simultaneous parallel runs on one bot's computer (computer execution lease stays per-bot).
- Per-session model/persona overrides (bot config stays bot-level in v1).

## Product assumptions made autonomously (reversible)

- A1: "Session" = a Thread row; we relax `botId @unique` to a non-unique index and add a `title` + `primary`/pinned marker rather than inventing a new entity. Migration is additive.
- A2: Group chats and external conversations are untouched (their uniques at :475/:477 remain).
- A3: v1 default session = today's thread, so nothing changes for messaging users.

## Open questions (need answers before plan)

- ~~Q1 resolved by research (2026-09-28):~~ the busy guard in `sendUserMessage` filters on `(threadId, botId)` (packages/db/src/events.ts ~378-388), run leases key on run id only (executor.ts:1103-1124), and per-bot locking exists only for the shared computer via the `(computerId, botId)`-unique `ComputerExecutionLease` (computer-lifecycle.ts:439-505; a second concurrent run gets `ComputerBusyError` and requeues with backoff) plus a momentary per-secret credential lock. Verdict: run/context wiring is already thread-scoped — relaxing `Thread.botId @unique` is the core change; the computer lease is the only genuine serialization and can stay per-bot (R2's exception).
- Q2 resolved by grill (2026-09-28): mobile (apps/mobile) is a bot-inbox app with no session list today; native-first decision — add a per-bot session list screen (Expo Router) between the inbox row and `app/thread.tsx`, which accepts a threadId parameter. Web gets a session switcher inside the existing bot chat view.

## Verification sketch (matrix rows to expand)

- V1: API — create 2 sessions for one bot; message both; assert separate histories and independent run acceptance (RPC + DB assertions).
- V2: Migration — pre-migrate DB with a bot thread; post-migration assert primary session exists, messages intact.
- V3: E2E (web) — switch sessions, rename, resume history after reload.
- V4: Telegram regression — inbound still lands on primary session.

## Grill resolutions (2026-09-28)

Full evidence trail: .super-speckit/grills/001-multi-session-agents/spec-grill.md.

- **Primary session** = `Thread.isPrimary Boolean @default(false)` with a Postgres partial unique index `(botId) WHERE is_primary` (invariant: exactly one primary per bot, DB-enforced). Migrated threads are stamped primary. All legacy `findFirst({ botId })` routing becomes `findFirst({ botId, isPrimary: true })`.
- **Addressing**: `threadTarget` gains an optional `threadId`; botId-only resolves to the primary session. New `sessions/list|create|rename|delete` RPC group. Sends/history reuse `threads/*`.
- **Relation flip is breaking, not additive**: `Bot.thread Thread?` becomes `threads Thread[]`; singular navigation (`bot.thread`) is replaced by a primary-thread helper across api/adapters; ~8 test/CLI `thread.findUnique({ where: { botId } })` sites are migrated. Blast radius inventoried in the grill.
- **Deletion rules**: refuse deleting the last remaining session; deleting the primary with siblings promotes earliest-createdAt in the same transaction; refuse deleting a session with an active run (explicit error; the per-bot computer lease must never be torn down by a session delete).
- **Ordering**: `Thread.lastMessageAt DateTime?` bumped in `createThreadMessageInTransaction`; list order `lastMessageAt desc nulls last, createdAt desc`; cursor `(lastMessageAt, id)`.
- **Migration**: repo conventions — DROP unique CONCURRENT, add columns, backfill primary, CREATE partial unique CONCURRENT + VALIDATE. Down-migration is a documented exception (unsupported once a bot has multiple sessions).
- **Realtime**: new `session.created/renamed/deleted` events; sidebar aggregates defined as unread = OR over the bot's sessions, preview and run status = primary session's.
- **Known v1 behavior (accepted)**: bot-level memory is shared across sessions (R2 does not list memory; reversal path: revisit on user signal). `bots/duplicate` clones the primary session only. `clearThread` keeps its bot-level `updatedAt` bump.

## Known v1 behaviors (accepted — not bugs)

These behaviors are intentional in v1 and have documented reversal paths if user research shows they should change.

| Behavior | Reversal path |
|---|---|
| Bot-level memory is shared across all of a bot's sessions (the `memoryScope` field is `shared` by default for bots with multiple sessions). R2 does not list memory isolation as a requirement. | Revisit on user signal: scope memory per-session (requires `memoryScope` on `Thread`, new UI affordances, and migration of existing bot memories). |
| `bots/duplicate` clones only the primary session; secondary sessions of the source bot are not duplicated. This was a deliberate product decision during S4. | Add a `deep: boolean` option to the duplicate RPC that also clones non-primary sessions. |
| `clearThread` bumps `bot.updatedAt` (not `thread.updatedAt`), keeping the bot-level timestamp used for staleness/changed detection in the codebase. | Move the `updatedAt` bump to the thread level if per-session staleness tracking is needed. |
