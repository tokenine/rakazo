# Verification matrix — 001 Multi-session agents

Route: milestone. Slices: S1 schema+resolution+legacy pinning · S2 sessions RPC + web switcher + events · S3 mobile session screen · S4 guardrails + aggregates + closure.
Grill evidence: .super-speckit/grills/001-multi-session-agents/spec-grill.md

| # | Requirement (spec ref) | Verification | Evidence expected | Slice |
| --- | --- | --- | --- | --- |
| V1 | R1 create/list sessions | API test: create 2 named sessions for one bot; list returns both, ordered lastMessageAt desc nulls last, createdAt desc (tie + empty-session cases) | vitest assertion output | S1/S2 |
| V2 | R2 independent history/serialization | API test: message session A and B alternately; separate message lists; both accept runs while busy-guard filters per thread | vitest | S1 |
| V3 | R2 computer lease exception | Existing computer-lifecycle tests still pass (per-bot serialization untouched) | vitest suite pass | S1 |
| V4 | R6 lossless migration | Integration test: DB with existing bot thread → migrate → thread is primary, messages intact, bot DTO threadId unchanged; partial unique index `(botId) WHERE is_primary` exists; migration re-run idempotent | test-integration | S1 |
| V5 | R5 messaging regression | API test: inbound DM lands on primary session; peer DM delivery unchanged | vitest | S1 |
| V6 | R3 switch/rename/delete | E2E web: switch sessions, rename, delete non-primary, last-session guard | Playwright spec | S2 |
| V7 | R4 compaction-aware resume | E2E web: history (summary + tail) intact after reload; mobile test asserts session list renders (or recorded degradation) | Playwright + mobile test | S2/S3 |
| V8 | Legacy compatibility | Existing router/web e2e suites pass unmodified (botId-only inputs land on primary) | CI suites | S1-S3 |
| V9 | Addressing (grill #1) | API test: threads/send + threads/get with explicit non-primary threadId; botId-only resolves to primary | vitest | S1 |
| V10 | Legacy pinning (grill #3) | Grep gate: zero unscoped `thread.findFirst({ where: { botId } })` remain; all 7 sites use `isPrimary: true` predicate; CI grep + vitest | CI grep + vitest | S1 |
| V11 | Primary invariant (grill #3) | DB test: inserting a second `isPrimary` row for one bot violates the partial index; helper `getPrimaryThread` returns the row | vitest DB assertion | S1 |
| V12 | Session lifecycle events (grill #9) | API test: session.created/renamed/deleted emitted on the thread event feed; second subscribed client updates list without reload | vitest + Playwright | S2 |
| V13 | Deletion rules (grill #5/#6) | API test: delete with active run → explicit error, lease + other sessions intact; delete primary with siblings → earliest createdAt promoted in same tx; delete last remaining session → refused | vitest | S2 |
| V14 | Owner scoping (grill #4) | API test: non-owner space member cannot list/create/rename/delete another user's bot sessions (mirror repos.getBot scoping) | vitest | S2 |
| V15 | Mobile session screen (grill Q2) | Device/manual: per-bot session list screen renders, create + switch work; thread.tsx opens the chosen session | mobile test or recorded manual evidence | S3 |
| V16 | Sidebar aggregates (grill #9) | API test: bot unread = OR over sessions; preview + run status from primary session; bots/duplicate clones primary only | vitest | S4 |
| V17 | Lease teardown guard (grill #5) | Integration test: deleting a session never mutates ComputerExecutionLease rows or other sessions' runs | vitest | S4 |
| V18 | Known v1 behaviors documented | QA report lists accepted v1 behaviors (bot-level memory shared across sessions; clearThread bot.updatedAt bump) as explicit not-applicable/not-verified rows | QA summary | S4 |
