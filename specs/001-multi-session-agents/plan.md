# Plan — 001 Multi-session agents

Spec: `specs/001-multi-session-agents/spec.md` · Base: 7826e422 · Branch `ss/feature/001-multi-session-agents`

## Key finding (research, 2026-09-28)

Run/context wiring is already thread-scoped. The single hard constraint is
`Thread.botId @unique` (schema.prisma:473) plus ~10 call sites that resolve "the bot's
thread" by botId. Relax the constraint, introduce a **primary session** concept, and make
every legacy botId-keyed path pin to the primary session so existing clients (web shell,
mobile, Telegram inbound, routines) work unchanged.

## Approach

- **Schema**: `Thread.botId` loses `@unique` (keep nullable, cascade); add `Thread.title String?`,
  `Thread.isPrimary Boolean @default(false)`, `Thread.lastMessageAt DateTime?` (ordering; bumped in
  `createThreadMessageInTransaction`); add `@@index([botId])`; partial unique index
  `one primary per bot` via SQL (precedent: taught_skills partial index at schema.prisma:771).
  Backfill: every existing bot thread becomes primary (each bot has ≤1 today).
  **Breaking (grill-confirmed)**: Prisma back-relation flips `Bot.thread Thread?` → `threads Thread[]`;
  singular `bot.thread` navigation (~6 adapter/api sites) is replaced by a primary-thread helper;
  ~8 test/CLI `thread.findUnique({ where: { botId } })` sites migrate. Inventory in
  .super-speckit/grills/001-multi-session-agents/spec-grill.md.
- **Thread resolution choke point**: `apps/api/src/thread-target.ts resolveThreadTarget` gains
  optional `threadId` input; botId-only resolution falls back to primary → earliest thread.
  `threadTarget` contract (rpc.ts:93) gains optional `threadId`.
- **Legacy pinning (become primary-thread lookups)**: messaging-inbound.ts:124/690/740,
  packages/db/src/messaging.ts:60/132/158, executor.ts:979-995 (routines with null threadId),
  messaging-delivery.ts:284 (peer DM), clearThread guard (events.ts:257-260) becomes
  threadId-scoped. `createBot` (repos.ts:469) marks its thread primary.
- **New RPCs** (threads group, contract + router + tests): `list` (bot's sessions with
  preview/unread), `createSession` (named), `renameSession`, `deleteSession` (never deletes the
  last/primary session; promote earliest if primary deleted).
- **DTO**: bot DTO keeps `threadId` (= primary) for backward compatibility; listBots includes
  session list metadata only where cheap (sidebar preview stays primary-thread preview in slice 1).

## Slices

1. **S1 backend** (this slice): schema + migration + repos + thread-target + legacy pinning + red-green
   tests (V2/V4/V5/V9/V10/V11). Deterministic offline (testkit fakes).
2. **S2 sessions RPC + web UI**: sessions/list|create|rename|delete RPCs (V1/V6/V12/V13/V14), session
   switcher in bot panel (route param `/{botId}/{threadId?}`), session lifecycle events. Design-first
   required (tsx paths): static prototype decision recorded before implementation.
3. **S3 mobile**: per-bot session list screen per native-first rules (V15); degradation recorded if needed.
4. **S4 verification + guardrails**: sidebar aggregates (V16), lease teardown guard (V17), matrix closure
   (V18); e2e web spec for session flows; Telegram regression assertion; milestone reassessment.

## Risks / constitution checks

- Protected path `migrations/**` → plan reviewed independently before merge; migration must be
  additive and lossless (R6).
- Group/externalConversation uniques untouched (verified schema.prisma:475/:477).
- Computer lease stays per-bot (spec R2 exception, ADR-0001 untouched).
- Backward compat: all existing RPC inputs (botId without threadId) resolve to primary.
