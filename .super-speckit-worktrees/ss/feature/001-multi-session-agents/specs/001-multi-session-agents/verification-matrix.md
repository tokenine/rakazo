# Verification matrix — 001 Multi-session agents

| # | Requirement (spec ref) | Verification | Evidence expected | Slice |
| --- | --- | --- | --- | --- |
| V1 | R1 create/list sessions | API test: create 2 named sessions for one bot; list returns both with previews | vitest assertion output | S1 |
| V2 | R2 independent history/serialization | API test: message session A and B alternately; separate message lists; both accept runs while busy-guard filters per thread | vitest | S1 |
| V3 | R2 computer lease exception | Existing computer-lifecycle tests still pass (per-bot serialization) | vitest suite pass | S1 |
| V4 | R6 lossless migration | Integration test: DB with existing bot thread → migrate → thread is primary, messages intact, bot DTO threadId unchanged | test-integration | S1 |
| V5 | R5 messaging regression | API test: inbound DM lands on primary session; peer DM delivery unchanged | vitest | S1 |
| V6 | R3 switch/rename/delete | E2E web: switch sessions, rename, delete non-primary, last-session guard | Playwright spec | S2 |
| V7 | R4 resumable on any surface | E2E web: history intact after reload; mobile test asserts session list renders (or recorded degradation) | Playwright + mobile test | S2/S3 |
| V8 | Legacy compatibility | Existing router/web e2e suites pass unmodified (botId-only inputs) | CI suites | S1-S3 |
