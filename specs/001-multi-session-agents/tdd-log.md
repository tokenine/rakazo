# TDD log — 001 Multi-session agents, slice 1

Strict red-green evidence per the mandatory contract. Each entry: the test, the
observed failure reason before implementing, then the green result.

## Cycle A — schema + session repos (2026-09-28)

Baseline: `a020b565` (WIP schema + migration, reviewed — additive index/column swap,
lossless backfill, one-primary-per-bot partial unique; no unit seam of its own; its
behavior is covered by V4 integration in the checker lane).

- RED `createRepos.listSessions` (returns sessions with preview/unread) — `repos.listSessions is not a function`
- RED `createRepos.listSessions` (rejects foreign bots) — `repos.listSessions is not a function`
- RED `createRepos.createSession` (creates named non-primary session) — `repos.createSession is not a function`
- RED `createRepos.createSession` (rejects foreign bots) — `repos.createSession is not a function`
- RED `createRepos.renameSession` (renames owned session) — `repos.renameSession is not a function`
- RED `createRepos.renameSession` (rejects foreign/ non-bot threads) — `repos.renameSession is not a function`
- RED `createRepos.deleteSession` (deletes non-primary) — `repos.deleteSession is not a function`
- RED `createRepos.deleteSession` (refuses last remaining session) — `repos.deleteSession is not a function`
- RED `createRepos.deleteSession` (promotes earliest remaining when primary deleted) — `repos.deleteSession is not a function`
- RED `bot session pinning in bot DTOs` (threadId/unread from primary, not oldest) —
  `mapBot` still read the singular `thread` relation, so the primary-first fixture was ignored
- GREEN all ten after: `SESSION_ORDER` shared ordering, `mapBot`/`listBots`/
  `listSpaceBotsForSpaces`/`getBot`/`createBot`/`setBotComputer` migrated to
  primary-first `threads`, `listSessions`/`createSession`/`renameSession`/`deleteSession`
  added, `LastSessionError` guard, `BotSession` contract type. Final:
  `packages/db/src/repos.test.ts` 21/21 passed.

Fixture migration note: existing `listBots`/`listSpaceBotsForSpaces` fixtures changed
shape only (`thread: {...}` → primary-first `threads: [...]`) to keep emulating Prisma
output; their behavioral assertions are unchanged. One real fix surfaced during green:
`listBots` initial run-batching now reads `bot.threads[0]`.

## Cycle B — legacy pinning, threadId targeting, last-activity ordering (2026-09-28)

Note: part of this cycle's implementation was recovered from an interrupted maker
session already present (uncommitted) in the worktree. Entries marked RED were
observed in this session by temporarily reverting the implementation; entries
marked RECOVERED had their failing state already consumed by the interrupted run —
their green state was re-verified here.

Schema/type gate (recovered): `turbo check` for @rakazo/db failed with 8 errors
(`'thread' does not exist in type 'BotSelect/BotInclude'`, `SessionRow` missing
`updatedAt` → replaced by `lastMessageAt`); all packages now typecheck clean.

- RED `createThreadMessageInTransaction` bumps `lastMessageAt` —
  `AssertionError: expected undefined to be an instance of Date` (bump line removed)
- GREEN `messages.test.ts` 2/2 after `lastMessageAt: new Date()` in the thread update.

- RED `createRepos.listSessions` orders primary first then by last activity —
  `AssertionError: expected "vi.fn()" to be called with arguments: [{ where: { botId: 'bot-1' }, … }]`
  (orderBy temporarily reverted to PRIMARY_SESSION_ORDER)
- GREEN after `SESSION_LIST_ORDER` ([isPrimary desc, lastMessageAt desc nulls-last, createdAt desc]).

- GREEN `createRepos.listSessions` keeps each session's history independent (V2):
  per-thread newest-message preview; separate `threadId` lookups asserted.
- GREEN `createRepos.createSession` never creates a second primary (V11 repos-seam
  invariant): every create is `isPrimary: false`, so the partial unique index
  `threads_botId_isPrimary_key` cannot be violated through repos.
- RECOVERED `resolveThreadTarget` V9: botId-only pins primary; explicit threadId
  resolves when actor-owned (scoped by id+botId+spaceId+userId); foreign threadId →
  `IsolationError`. `apps/api/src/thread-target.test.ts` 3 new tests green.
- RECOVERED V5/T5: the 7 legacy production lookups (messaging-inbound ×3,
  messaging.ts ×3, messaging-delivery ×1) pinned with
  `orderBy: PRIMARY_SESSION_ORDER` (= primary, then earliest); messaging.test.ts
  asserts the orderBy shape.
- V10 grep gate: `grep -rn "findFirst|findUnique" packages apps | grep thread… | grep botId`
  minus isPrimary/PRIMARY_SESSION_ORDER scoped hits = 0.

Fixture migration (RECOVERED-then-RED in this session): after switching raw bot
reads to `threads[0]`, 53 fixture-stale tests failed across adapters/api test files
(`TypeError: Cannot read properties of undefined (reading '0')` etc.); fixtures
were migrated to the `threads` array shape. Final: @rakazo/db 121 passed / 6
skipped, @rakazo/adapters 2011 passed / 25 skipped, @rakazo/api 389 passed.
