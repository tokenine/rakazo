# Evidence-labeled Spec Grill — 001-multi-session-agents

Purpose map: .super-speckit/purpose/001-multi-session-agents/purpose-map.md
Human confirmation: .super-speckit/purpose/001-multi-session-agents/decision.json (confirmed by maintainer via purpose gate)
Runs: Builder (scout run 1), Examiner (scout run 2), Investigator (scout run 3) — independent agents; Resolver integrated.

## Builder

Smallest coherent interpretation: relax the 1:1 bot-thread invariant into 1:N and route every existing "the bot's thread" lookup through an explicit session-resolution rule (primary session by default, explicit threadId otherwise). R1–R2 need no new run/context machinery — run serialization, busy guards, history/compaction, and unread are already threadId-scoped; only the computer lease is per-bot and stays (R2's stated exception). R3 is thin CRUD + last-activity ordering over Thread rows. R4 is nearly free: sessions ARE Threads. R5+R6 apply the same rule to legacy paths; migration stamps today's thread as primary.

Proposed shape: (a) additive Thread-only schema delta (`title`, `isPrimary`, `lastMessageAt`, botId index); (b) one resolution choke point — `resolveThreadTarget` gains optional `threadId`, botId-only falls back to primary → earliest createdAt (apps/api/src/thread-target.ts:268-303); (c) `sessions/list|create|rename|delete` RPC group; (d) mechanical replacement of botId-unique lookups; (e) session switcher in the existing bot chat view; mobile gets a per-bot session list screen (native-first).

## Examiner

Ten challenges, all repo-grounded (path:line in evidence):

1. **API contract addressing (blocker)** — every threads/* RPC addresses {botId, groupId} only; no threadId-addressed endpoint; e2e confirms (apps/web/e2e/golden.spec.ts:477-479). R3 surface unplanned without an addressing decision.
2. **Schema change is not additive (blocker)** — dropping `botId @unique` flips Prisma back-relation `Bot.thread Thread?` → `threads Thread[]` (compile-breaking); singular consumers: packages/db/src/repos.ts:366-378, packages/adapters/src/bot-messages.ts:97, agent-connections.ts:253, child-bots.ts:94+97, executor.ts:974-977, computer-idle.ts:336-339; ≥8 test/CLI sites use `findUnique({ where: { botId } })` (testkit runs-list/journeys/bot-secrets/executor-lifecycle/authorization tests, apps/api/src/cli/mobile-screenshots.ts:226).
3. **"Primary" undefined; findFirst nondeterministic (major)** — 7 production lookups `thread.findFirst({ where: { botId } })` with no orderBy would misroute Telegram after relaxation (apps/api/src/messaging-inbound.ts:124,690,740; packages/db/src/messaging.ts:60,132,157-158; packages/adapters/src/messaging-delivery.ts:284). Invariant "exactly one primary per bot" must be DB-enforced.
4. **Authorization unspecified (major)** — all bot-thread ops are owner-scoped (`repos.getBot` filters spaceId+userId, repos.ts:367-372); R1 must say owner-only or expand to space members. No threads/rename|delete endpoint exists; cascade and Routine dangling (executor.ts:977-978) unspecified.
5. **Session deletion vs bot-level lease/runs (major)** — deleting a session whose run holds the per-bot ComputerExecutionLease, or whose stop path cancels computer work (thread-target.ts:1022-1024, cancelRunWork), breaks the per-bot lease non-goal for other sessions.
6. **0-sessions / deleted primary reachable (major)** — nothing prevents deleting all sessions; messaging.ts:132-133 and child-bots.ts:97 throw on missing thread → Telegram users get server errors. Promotion rule unspecified.
7. **R3 ordering has no field (major)** — Thread has no updatedAt/lastActivityAt (schema.prisma:459-478); ordering by max(seq) is expensive and undefined for empty threads; ChatGroup.updatedAt is the precedent.
8. **Migration failure/recovery + down-migration (major)** — multi-step migration has no atomicity plan; repo convention is CONCURRENT + NOT VALID/VALIDATE two-phase (20260829210001_*, 20260830010000_* precedents); down-migration fails outright with N sessions.
9. **No session lifecycle events; bot-level aggregates ambiguous (major)** — events.ts has no session.* events; repos.ts:144-148 sidebar preview/unread/run-status assume one thread.
10. **Edge cases (minor)** — R4 "full history" contradicts compaction (summary + tail is the real contract); bots/duplicate (router.ts:1115-1118) clones the single thread; clientNonce `send:` prefix must not collide.

## Investigator

All six material probes classified **proven** with file:line evidence (full answers in grill run transcript):

1. `Thread.botId` uniqueness is assumed far beyond the schema — `bot.thread` relation navigation in apps/api (thread-target.ts:276-283, onboarding.ts:73-79, router.ts:2013/2111/2143-2147/2514-2518/2619-2622/4905/4931, taught-skills.ts, webhook-inbound.ts:106,132, bot-update.ts:16-44), adapters (agent-connections.ts:253-255,318; bot-messages.ts:96-97; child-bots.ts:112-129), and DTO level (repos.ts:49,81-84,145,168 singular threadId/unread/preview). `findFirst({botId})` sites: messaging-inbound.ts:124,690,740.
2. Choke point: `resolveThreadTarget` (thread-target.ts:268-303) resolves all 12 `threads/*` RPCs (router.ts:1550-1792); new sessions/* endpoints belong adjacent, reusing ThreadTarget; contracts in @rakazo/contracts.
3. Mobile is a bot-inbox app with no session list (app/index.tsx:259-283,774-828,896-916); thread.tsx takes a thread target and can accept threadId; lib/inbox helpers reusable.
4. Unread/compaction/nextEventSeq/nextMessageSeq are already per-Thread columns (schema.prisma:469-495; messages.ts:60-70; events.ts:259-261; thread-target.ts:1129-1135) — no schema change needed for per-session state.
5. Prisma migrations: ~90 SQL folders, strong data-migration precedent (20260830150000_organization_spaces INSERT...SELECT backfill; *_idx_concurrent / *_fkey_not_valid / *_validate two-phase conventions); DB is Postgres.
6. clearThread writes `bot.updatedAt` bot-level (events.ts ~300-333) — one bot-row semantic to note; message bookkeeping is thread-scoped and safe; busy guard already `(threadId, botId)`-scoped.

## Resolver

| Question | Resolution | Classification | Evidence or rationale | Verification consequence |
|---|---|---|---|---|
| Session addressing scheme | `threadTarget` gains optional `threadId`; botId-only resolves to primary session; new `sessions/*` RPC group for CRUD | assumed (Builder+Examiner convergent; reversible) | Examiner #1 blocker resolved by choke-point extension; contracts live in @rakazo/contracts | V1 must send with explicit non-primary threadId; e2e threads.spec regression on botId-only |
| Primary definition + invariant | `Thread.isPrimary Boolean @default(false)` + Postgres partial unique index `(botId) WHERE is_primary`; legacy lookups become `findFirst({ botId, isPrimary: true })` | assumed (flag over derived-oldest: explicit user pin/switch semantics; reversible by rule change) | Examiner #3; repo Postgres partial-index precedent proven (20260830* migrations) | V2 asserts partial index + backfill; all 7 findFirst sites updated; invariant test creating 2 primaries must fail |
| Prisma relation flip | Replace singular `Bot.thread` usage with `threads Thread[]` + `getPrimaryThread(botId)` helper in repos; update ~6 adapter/api navigation sites + 8 test/CLI `findUnique({botId})` sites | proven (breaking, enumerated) | Examiner #2 with path:line inventory; Investigator Q1 | Compile-green is the gate; inventory lives in plan tasks; no silent findFirst remains (grep gate) |
| R1 authorization scope | Sessions are owner-scoped (same actor as today); space-member sharing is out of scope v1 | assumed (restates existing proven behavior) | repos.ts:367-372 scoping is proven; expanding would be a materially larger authz change | Matrix row: non-owner space member cannot list/create/delete another user's bot sessions |
| Delete vs active run/lease | Block session delete while a run is active on the thread (explicit error); delete is metadata+history cascade in one tx | assumed (chosen rule; reversible) | Examiner #5; lease teardown evidence thread-target.ts:1022-1024 | V-row: delete-with-active-run rejected; delete path leaves lease and other sessions intact |
| Primary deletion | Refuse deleting the last remaining session; deleting primary with siblings promotes earliest-createdAt in the same tx | assumed (mirrors createBot guarantee messaging.ts:131-133) | Examiner #6 | V-row: Telegram inbound still lands after primary deletion + auto-promotion |
| R3 ordering | Add `Thread.lastMessageAt DateTime?`, bumped in createThreadMessageInTransaction; order `lastMessageAt desc nulls last, createdAt desc`; cursor (lastMessageAt, id) | assumed (ChatGroup.updatedAt precedent proven; seq-derived rejected — no index, undefined for empty) | Examiner #7; groups preview pattern | V1 ordering assertions incl. tie + empty-session case |
| Migration shape | Follow repo conventions: DROP unique CONCURRENT, add columns, backfill primary, CREATE partial unique CONCURRENT + VALIDATE; down-migration documented exception (unsupported with N sessions) | assumed (conventions proven) | Examiner #8; 20260830150000_organization_spaces precedent | V2 extended: pre/post + idempotency; failure-injection test between steps in CI-optional lane |
| Session lifecycle events | Add `session.created/renamed/deleted` events; sidebar aggregates defined: unread = OR over bot sessions; preview + run status = primary session's | assumed (v1 definition; reversible) | Examiner #9; repos.ts:144-148 proven ambiguity | V3 extended: second surface sees session list change without reload |
| R4 "full history" wording | Spec amended: resume returns compaction summary + post-compaction tail (compaction-aware resume) | proven contradiction, wording fix only | Examiner #10b; schema.prisma:469 | V3 assertion uses compaction-aware wording |
| Memory scoping across sessions | Bot-level memory shared across sessions in v1; not a purpose conflict (R2 enumerates history/compaction/runs/unread, not memory) | assumed + reversal path | Builder needs-investigation; adapter-kit memory interfaces are botId-scoped (proven) | Acceptance note in QA: cross-session memory bleed is known v1 behavior; revisit on user signal |
| Mobile Q2 (open question) | Native-first: per-bot session list screen (Expo Router) between inbox and thread.tsx; thread.tsx accepts threadId param | decided (routine product decision, recorded) | Investigator Q3: no session list exists today; inbox pattern is the native surface | Mobile e2e/manual lane: create + switch session on device |
| bots/duplicate behavior | Duplicates bot with primary session only (not all sessions) | assumed | Examiner #10c; router.ts:1115-1118 clones single thread today | Minor matrix row; document in change story |
| clearThread bot.updatedAt bump | Accepted v1 (bot-level freshness on clear); thread-scoped history reset already safe | proven behavior, accepted | Investigator Q6; events.ts ~300-333 | None beyond existing clear tests |
| threadTarget contract location | packages/contracts (exact file inferred, verify at implementation) | inferred | Builder hypothesis rpc.ts ~93 | Maker verifies before editing |

## Purpose conflicts

None. No discovery alters the confirmed outcome, affected people, success signal, or non-goals. R4 wording was clarified (compaction-aware resume) without changing the success signal's substance.

## Result

- [x] Ready for planning and TDD
- [ ] Return to Purpose Gate
- [ ] Blocked by external authority or missing evidence
