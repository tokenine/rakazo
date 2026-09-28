# Tasks — 001 Multi-session agents

Spec: specs/001-multi-session-agents/spec.md · Plan: specs/001-multi-session-agents/plan.md ·
Matrix: specs/001-multi-session-agents/verification-matrix.md · Route: milestone ·
Grill: .super-speckit/grills/001-multi-session-agents/spec-grill.md

Convention: red-green per slice — the slice's matrix rows are written as failing tests first,
then implementation turns them green. Deterministic offline (testkit fakes, no network).

## User Story 1 — Sessions exist and legacy paths stay correct (S1, P1)

**Goal**: schema + migration + primary-session resolution + legacy routing pinned. Existing
single-session behavior is bit-for-bit preserved; a second session can exist and be addressed.

### Tasks

- [ ] T1 (P1) Schema: drop `Thread.botId @unique` → `@@index([botId])`; add `title String?`,
      `isPrimary Boolean @default(false)`, `lastMessageAt DateTime?` (packages/db/prisma/schema.prisma)
- [ ] T2 (P1) Migration: CONCURRENT drop of unique index, add columns, backfill `isPrimary=true`,
      CREATE partial unique index `(botId) WHERE is_primary` + VALIDATE; follow
      20260830150000_organization_spaces / *_idx_concurrent conventions
      (packages/db/prisma/migrations/<new>/migration.sql) — V4, V11
- [ ] T3 (P1) Replace `Bot.thread` relation with `threads Thread[]`; add `getPrimaryThread(botId)`
      helper in repos; migrate singular-navigation sites (repos.ts:366-378, adapters bot-messages.ts:97,
      agent-connections.ts:253, child-bots.ts:94+97, executor.ts:974-977, computer-idle.ts:336-339)
      — compile gate
- [ ] T4 (P1) Migrate test/CLI `thread.findUnique({ where: { botId } })` sites
      (testkit runs-list:195, journeys:429/1131/1246, bot-secrets:338, executor-lifecycle:868,
      authorization:277, api cli/mobile-screenshots.ts:226)
- [ ] T5 (P1) Pin 7 legacy lookups to `findFirst({ botId, isPrimary: true })`
      (messaging-inbound.ts:124,690,740; messaging.ts:60,132,157-158; messaging-delivery.ts:284)
      — V10 grep gate + V5
- [ ] T6 (P2) `resolveThreadTarget` gains optional `threadId` (actor-scoped, else primary →
      earliest createdAt); `threadTarget` contract gains optional `threadId`
      (thread-target.ts:268-303; contracts rpc.ts — verify exact file first) — V9
- [ ] T7 (P2) `createThreadMessageInTransaction` bumps `lastMessageAt` (messages.ts:60-70)
- [ ] T8 (P1) Red-green tests: V2 (independent history), V4 (migration lossless + idempotent),
      V5 (Telegram inbound → primary), V9 (explicit threadId), V10 (grep gate), V11 (partial index)

**Checkpoint**: validate + status strict; S1 matrix rows green; commit candidate SHA.

## User Story 2 — Session CRUD on every surface' backend + web switcher (S2, P1)

**Goal**: users create/switch/rename/delete sessions; other connected surfaces see changes live.

### Tasks

- [ ] T9 (P1) `sessions/list|create|rename|delete` contracts (packages/contracts) + router group
      (apps/api/src/router.ts, threads-adjacent) — V1
- [ ] T10 (P1) Deletion rules: refuse last remaining session; promote earliest createdAt on primary
      delete (same tx); refuse delete with active run — V13
- [ ] T11 (P2) Owner scoping on all sessions RPCs (mirror repos.getBot spaceId+userId) — V14
- [ ] T12 (P2) `session.created/renamed/deleted` events on the thread feed — V12
- [ ] T13 (P1) Web session switcher in bot chat view (list/switch/rename/create/delete, unread badges);
      design-first static prototype decision recorded before implementation (apps/web, packages/chat-ui)
      — V6
- [ ] T14 (P2) E2E: switch/rename/delete/resume-after-reload; live list update without reload
      (apps/web/e2e) — V6, V7, V12

**Checkpoint**: validate + status strict; S2 rows green; commit candidate SHA.

## User Story 3 — Mobile sessions (S3, P2)

- [ ] T15 (P1) Per-bot session list screen (Expo Router) between inbox row and thread.tsx;
      thread.tsx accepts threadId param; native sheets/menus for rename/delete
      (apps/mobile) — V15
- [ ] T16 (P3) Mobile degradation note in QA report if CI cannot capture (per repo rule)

**Checkpoint**: validate; V15 evidence or recorded degradation.

## User Story 4 — Guardrails, aggregates, closure (S4, P2)

- [ ] T17 (P2) Sidebar aggregates: unread OR over sessions; preview/run-status from primary;
      bots/duplicate clones primary only — V16
- [ ] T18 (P1) Lease teardown guard test: session delete never touches ComputerExecutionLease — V17
- [ ] T19 (P2) QA summary: matrix rows labeled verified/not-verified/not-applicable; accepted-v1
      behaviors (memory shared, clearThread bump) as explicit rows — V18
- [ ] T20 (P1) Milestone reassessment artifact + route/Atlas/Change Story update after verified slice
      (super-speckit.reassess)

## Dependencies

S1 → S2 → S3/S4. T3+T4+T5 are one atomic compile-green move. T6 depends on T2 (primary exists).
T13 requires design-first decision first (tsx paths in config `design.required_when_paths`).
