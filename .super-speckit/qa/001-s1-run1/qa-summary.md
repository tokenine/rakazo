# QA summary — 001-multi-session-agents, slice S1

- Candidate: `f68d7bfb` → verified stack tip `5262c142` (F-1 81647881, F-2 0d893595, F-3 ae301f6e, F-4 5262c142 — each independently retested by a checker who did not author the fix)
- Gate verdict: **PASS** (qa-report.md §7–§10)

## Matrix rows

| Row | Verdict | Evidence |
| --- | --- | --- |
| V1 (S1 portion) | verified | repos create/list ordering tests |
| V2 | verified | repos.test.ts "keeps each session's history independent" |
| V3 | verified | adapters computer-control/lease suites (2011 passed / 25 skipped) |
| V4 | verified | real-Postgres migration proof: 91-migration pre-state → fixtures → only multi_session migration applies → isPrimary backfill, messages intact, partial unique index enforced, second primary rejected, re-deploy no-op |
| V5 | verified | messaging-inbound primary-pin test + messaging-delivery peer fan-out pin |
| V6 | not-applicable (S2) | web switcher ships in S2 |
| V7 | not-applicable (S2/S3) | resume e2e lands with switcher |
| V8 (S1 portion) | verified | api router suite 389 unmodified (botId-only inputs resolve primary) |
| V9 | verified | thread-target resolveThreadTarget ×3 (botId-only → primary; explicit owned; explicit foreign rejected) |
| V10 | verified | zero unscoped botId-only thread lookups at stack tip (gate covers findFirst/findUniqueOrThrow/findFirstOrThrow) |
| V11 | verified | repos one-primary invariant test + real-Postgres unique violation |
| V12–V17 | not-applicable (S2–S4) | later slices |
| V18 | not-applicable | accepted v1 behaviors listed: bot-level memory shared across sessions; clearThread bumps bot.updatedAt |

## Defect loop

Four confirmed bugs, all fixed + independently retested: F-1 (testkit lookup pin), F-2 (testkit OTP signup, 13 files testkit-only), F-3 (executor 1:many relation filter — the only product-code defect), F-4 (journeys passwordless deletion). No open findings. Evidence: qa-report.md, proof-pack.md, bugs/001-f{1,2,3,4}-*.md.

## OCR triage

Not-applicable — S1 is backend-only (schema/migration/repos/api/contracts); no UI surface changed.

## Merge decision

Autonomous merge enabled (`merge.autonomous_when_ready: true`); required gate status pass ✓; no open confirmed bugs ✓; OCR complete-as-N/A ✓. Merging stack tip `5262c142` into `ss/feature/001-multi-session-agents`.
