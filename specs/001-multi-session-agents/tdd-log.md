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

## Cycle B — targeting, session RPCs, legacy pinning

(appended as cycles complete)
