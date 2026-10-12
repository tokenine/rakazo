# Change story — 001 Multi-session agents

Base commit: 7826e422 · Spec: `spec.md` · Plan: `plan.md` · Status: awaiting review before S1 implementation

## 1. One-minute summary

Today every agent (bot) has exactly one conversation: the database enforces it
(`Thread.botId @unique`), and ten-plus code paths resolve "the bot's thread" by botId alone.
Users juggling several tasks with the same agent mix all their context into one history, and
history compaction reshapes it for every task at once. After this change, one agent has many
named, separately-contexted sessions the user can switch between and resume later — on web,
desktop, and mobile — while Telegram and routines keep landing on the agent's primary session
exactly as they do today.

## 2. Before / after user journey

| | Before | After |
| --- | --- | --- |
| Start a new task with my agent | Keep typing into the one thread; old task context bleeds in | Click "+ session" on the agent → fresh, empty context |
| Return to yesterday's task | Impossible — one shared, compacted history | Open the agent's session list, pick the session, full history resumes |
| Telegram message to the bot | Lands in the bot's thread | Unchanged: lands in the primary session |
| Delete a conversation | "Clear" wipes the only history and starts over | Delete a session (never the last one); other sessions untouched |
| Mobile | Same single thread | Session list in the bot view (slice 3) |

## 3. Business rules / decision table

| Situation | Rule |
| --- | --- |
| First session of a bot | Created implicitly (bot creation or first message), marked **primary** |
| New session created | Never auto-primary; named by user or defaulted |
| Primary session deleted | Earliest remaining session is promoted (a bot always has exactly one primary) |
| Last remaining session | Cannot be deleted (equivalent of today's "clear") |
| Two sessions run at once | Both run; the busy guard is per-thread (events.ts:378-388) |
| Both sessions need the bot's computer | Second run gets `ComputerBusyError` and requeues with backoff (computer-lifecycle.ts:439-505) — unchanged by design |
| Inbound Telegram DM / peer DM / routine without explicit thread | Pins to the primary session |
| Explicit `threadId` that isn't the actor's | Rejected (authorization unchanged) |

## 4. Proposed runtime story

```text
User clicks "+ session" in web shell (S2)
  → oRPC threads.createSession { botId, name? }        apps/api/src/router.ts (threads group)
  → repo createBotThread                                packages/db/src/repos.ts
      inserts Thread{botId, name, isPrimary:false}      (first-ever thread: isPrimary:true)
  → sidebar session list refreshes; user switches → route /{botId}/{threadId}
  → all threads.* calls now pass { botId, threadId }    thread-target.ts resolves explicitly
  → message → sendUserMessage (per-thread busy guard)   packages/db/src/events.ts
  → executor.run — thread-scoped context, lease logic unchanged
Legacy paths (Telegram inbound, peer DM, routines, old clients):
  → resolveThreadTarget({ botId }) → primary thread     thread-target.ts fallback
```

## 5. Affected capability map (from project-atlas/capability-map.md)

- **RPC surface** — threads group gains 4 procedures; `threadTarget` contract gains optional `threadId` (additive).
- **Run orchestration** — unchanged except legacy thread lookups pinned to primary.
- **Messaging inbound/outbound** — resolution pinned to primary; no behavior change.
- **Web UI shell / Mobile app** — new session switcher (S2/S3).
- **Data model** — `Thread` table + one new migration (protected path).

## 6. Blast radius

**Confirmed direct** (code-read): schema.prisma:473; repos.ts:66-84/143/158/295/325-352/373/469/511/524/594; thread-target.ts:268-291; messaging-inbound.ts:124/690/740; messaging.ts:60/132/158; executor.ts:979-995; messaging-delivery.ts:284; events.ts clearThread:248-310; router.ts threads group:1550-1780 + bootstrap:715-745; contracts rpc.ts:93/294-359; testkit mobile-screenshots.ts:226.

**Inferred** (reasoned, unverified): bot DTO consumers beyond web/mobile that assume `threadId` = the only thread (should be safe — it stays = primary); realtime fanout clients keying on threadId (they already key per thread).

**Unexamined boundaries**: third-party API consumers of the oRPC surface (none known — contract is additive); future features assuming botId→thread uniqueness (the constraint was doing implicit documentation work; the partial unique index on primary replaces it).

## 7. Data, contract, privacy, security, operational implications

- **Data**: one additive migration (index, two columns, partial unique, backfill `isPrimary=true`). Each bot has ≤1 thread today, so backfill cannot conflict. Reversible by dropping the added objects; the dropped unique constraint is re-creatable only while threads stay ≤1 per bot.
- **Contracts**: `threadTarget` and DTO changes are additive/optional — old clients keep sending botId only.
- **Privacy/security**: no new secrets, no new external access; session authorization reuses existing actor/space checks in `threads.*`. Importantly this *improves* context isolation between tasks (the user's motivating complaint).
- **Operational**: migration runs at api-container boot (plain SQL folders, HANDOFF §6); no worker/api coordination needed.

## 8. Alternatives / ADR links

- **New Session entity beside Thread** — rejected: duplicate history/compaction/run plumbing; Thread already owns all of it (spec A1).
- **Per-session model/persona overrides** — non-goal in v1 (spec).
- **Parallel runs on one computer** — rejected; ADR-0001 computer lease stays per-bot (spec R2 exception).
- No new ADR needed: this amends no locked decision; the one-primary invariant is recorded here and in the plan.

## 9. Verification story

Each spec requirement maps to matrix rows V1-V8 (verification-matrix.md): API tests for
session CRUD/independence/messaging-pinning (V1/V2/V5), integration test for lossless
migration (V4), existing suites for legacy compatibility (V8), e2e for switch/rename/delete
and resume (V6/V7). Nothing is claimed verified by this story.

## 10. Evidence ledger

- Base commit 7826e422; blast-radius call sites read directly in that tree (file:line above).
- Run-serialization research pass 2026-09-28 (thread-scoped guard, run-scoped leases).
- Migration behavior (boot-applied SQL folders) per docs/HANDOFF.md §6.
- Unknowns: see §6 unexamined boundaries; none block slice 1.
