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

1. R1 — A user can open any number of named sessions (threads) with the same bot in a space.
2. R2 — Each session keeps its own message history, compaction state, run serialization, and unread flag; runs in different sessions of one bot must not block each other except where a shared resource (the bot's computer lease) genuinely serializes them.
3. R3 — The user can list, switch between, rename, and delete a bot's sessions; last-activity ordering.
4. R4 — A session is resumable later on any surface (web, desktop, mobile) with full history.
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

- Q1: Does run serialization stay per-thread (preferred) or per-bot? Executor claims runs per run-row today; verify lease behavior with two active threads sharing one computer.
- Q2: Mobile: reuse the thread list pattern or add a session switcher inside the bot view? (native-first rule applies)

## Verification sketch (matrix rows to expand)

- V1: API — create 2 sessions for one bot; message both; assert separate histories and independent run acceptance (RPC + DB assertions).
- V2: Migration — pre-migrate DB with a bot thread; post-migration assert primary session exists, messages intact.
- V3: E2E (web) — switch sessions, rename, resume history after reload.
- V4: Telegram regression — inbound still lands on primary session.
