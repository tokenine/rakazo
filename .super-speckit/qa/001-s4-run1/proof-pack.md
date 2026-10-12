# Proof pack — 001-multi-session-agents · Slice S4 · Run 1

**Candidate**: `730d717a` | **Worktree**: `ss/qa/001-s4-run1` | **Date**: 2026-09-28

---

## V16 — Sidebar aggregates ✅

### Code change (repos.ts)

```
packages/db/src/repos.ts
  @@ -107,6 +107,8 @@ function mapBot(
+   // Grill #9: unread = OR across all of the bot's sessions (any session unread → bot unread).
+   const unread = bot.threads.some((t) => t.unread);
  @@ -119,7 +121,7 @@ function mapBot(
-     unread: primary.unread,
+     unread,
  @@ -199,6 +201,8 @@ export function createRepos(prisma: PrismaClient) {
+       // Grill #9: unread = OR across all sessions.
+       const unread = bot.threads.some((t) => t.unread);
  @@ -208,7 +212,7 @@ export function createRepos(prisma: PrismaClient) {
-        unread: primary.unread,
+        unread,
```

`mapBot` and `createRepos.listBots` both now compute `unread` as `bot.threads.some((t) => t.unread)`. `listSpaceBotsForSpaces` calls `mapBot` and is therefore covered.

### Test evidence (repos.test.ts)

```
describe("bots/duplicate clones primary only (V16)"
  it("createBot with parentBotId creates exactly one primary session, no clones of other sessions"
    → createdBotThreads.length === 1 ✅
    → createdBotThreads[0].isPrimary === true ✅

describe("sidebar aggregates (V16)"
  it("sets bot unread to OR over all sessions"
    → primary.unread=false, side.unread=true → bot.unread=true ✅
  it("sets bot unread to false when no session is unread"
    → both false → bot.unread=false ✅
  it("preview comes from the primary session"
    → side has "Side session newer text", primary has "Primary latest" → preview="Primary latest" ✅
  it("run status comes from the primary session's runs"
    → no runs → status="idle" ✅
  it("listSpaceBotsForSpaces aggregates unread as OR across all sessions"
    → sp-side.unread=true → sp-bot.unread=true ✅

Suite result: 131 passed / 8 skipped
```

### bots/duplicate product code path

The duplicate flow calls `repos.createBot(actor, { ..., parentBotId })`. `createBot` only calls `tx.thread.create` once (implicit primary) — confirmed by the mock's `createdBotThreads.length === 1` assertion. No product code needed to change for this behavior; it falls out of `createBot`'s existing single-thread creation.

---

## V17 — Lease teardown guard ✅

### Structural proof

```
$ grep -n "computer_execution_leases\|ComputerExecutionLease" packages/db/src/repos.ts
(no output — zero matches outside comments/imports/types)
```

`repos.deleteSession` (repos.ts:761-790) is the only session-deletion entry point. Manual inspection confirms it contains zero queries or mutations to `computer_execution_leases` or any lease table.

### Real Postgres run

```
Container: pg-s4check (postgres:16-alpine, :54337)
Schema: prisma db push (fresh)
Run: VERIFY_DATABASE=1 DATABASE_URL="postgresql://postgres:s4@localhost:54337/postgres"
     pnpm --filter @rakazo/db test sessions-lease-guard.postgres.test.ts

Result: Test Files 1 failed (space-membership — pre-existing) | 16 passed (17)
        Tests 1 failed | 138 passed (139)

sessions-lease-guard.postgres.test.ts:
  2 tests in describe.sequential (DB-gated, executes with DATABASE_URL)
  → both passed ✅
```

The `space-membership.postgres.test.ts` failure is pre-existing and unrelated to S4 (file unchanged in diff).

### Lease-guard test coverage

```
it("deleting a non-primary session does not mutate any ComputerExecutionLease rows"
  → inserts lease row
  → creates primary + side sessions
  → deletes side session
  → asserts lease row count unchanged ✅

it("deleting the primary session also leaves ComputerExecutionLease rows intact (V17)"
  → inserts lease row
  → creates primary + side sessions
  → deletes primary session (side remains)
  → asserts lease row count unchanged ✅
  → asserts side session still exists ✅
```

---

## V18 — Known v1 behaviors documented ✅

### spec.md (tail)

```markdown
## Known v1 behaviors (accepted — not bugs)

| Behavior | Reversal path |
|---|---|
| Bot-level memory is shared across all of a bot's sessions (the `memoryScope` field is `shared` by default for bots with multiple sessions). R2 does not list memory isolation as a requirement. | Revisit on user signal: scope memory per-session (requires `memoryScope` on `Thread`, new UI affordances, and migration of existing bot memories). |
| `bots/duplicate` clones only the primary session; secondary sessions of the source bot are not duplicated. This was a deliberate product decision during S4. | Add a `deep: boolean` option to the duplicate RPC that also clones non-primary sessions. |
| `clearThread` bumps `bot.updatedAt` (not `thread.updatedAt`), keeping the bot-level timestamp used for staleness/changed detection in the codebase. | Move the `updatedAt` bump to the thread level if per-session staleness tracking is needed. |
```

### verification-matrix.md (tail)

Same 3 rows, identical content. ✅

---

## Offline gates ✅

```
@rakazo/db test suite:
  Test Files  14 passed | 3 skipped (17)
  Tests  131 passed | 8 skipped (139)

@rakazo/adapters tsc --noEmit:
  0 errors
```

---

## Prior rows (V1–V15) — confirmed from prior runs

| Row | Run | Result | Evidence |
|---|---|---|---|
| V1 | S1 | ✅ verified | repos create/list ordering tests |
| V2 | S1 | ✅ verified | repos.test.ts "keeps each session's history independent" |
| V3 | S1 | ✅ verified | adapters 2011 passed / 25 skipped |
| V4 | S1 | ✅ verified | real-Postgres migration proof |
| V5 | S1 | ✅ verified | messaging-inbound + delivery pin tests |
| V6 | S2 | ✅ verified | Playwright e2e screenshots |
| V7 | S2 | ✅ verified | `/app/:botId/:threadId` route functional |
| V8 | S1 | ✅ verified | api suite 389 unmodified |
| V9 | S1 | ✅ verified | thread-target 3 assertions |
| V10 | S1 | ✅ verified | grep gate 0 unscoped |
| V11 | S1 | ✅ verified | partial-unique index + unique-violation test |
| V12 | S2 | ✅ verified | sessions.postgres.test.ts |
| V13 | S2 | ✅ verified | sessions.postgres.test.ts |
| V14 | S2 | ✅ verified | sessions.postgres.test.ts |
| V15 | S3 | ✅ verified | code correct, no runtime defects |

---

## Feature-level V1–V18 closure table

| Row | Status | Evidence |
|---|---|---|
| V1 | ✅ verified | S1: repos create/list ordering |
| V2 | ✅ verified | S1: repos.test.ts independent histories |
| V3 | ✅ verified | S1: adapters 2011/25 |
| V4 | ✅ verified | S1: real Postgres migration |
| V5 | ✅ verified | S1: messaging-inbound/delivery pin |
| V6 | ✅ verified | S2: Playwright e2e screenshots |
| V7 | ✅ verified | S2: thread route functional |
| V8 | ✅ verified | S1: api suite 389 |
| V9 | ✅ verified | S1: thread-target 3/3 |
| V10 | ✅ verified | S1: grep gate 0 unscoped |
| V11 | ✅ verified | S1: partial-unique + violation test |
| V12 | ✅ verified | S2: sessions postgres |
| V13 | ✅ verified | S2: sessions postgres |
| V14 | ✅ verified | S2: sessions postgres |
| V15 | ✅ verified | S3: code correct |
| V16 | ✅ verified | S4: 5 test assertions + code change |
| V17 | ✅ verified | S4: structural grep 0 + real PG |
| V18 | ✅ verified | S4: 3 rows spec + matrix |
