# TDD log — 004 Code mode, slice 7 (workspace shell amendment)

Strict red-green evidence per the mandatory contract. Each entry: the test, the
observed failure reason before implementing, then the green result.
Baseline before this slice: `@rakazo/adapters` suite has ~18-19 environmentally
failing tests on clean macOS (real-spawn/env-scrub suites: process-sandbox,
process-sandbox-secrets, process-collision-matrix, coding-omp-protocol,
coding-secrets-flow, coding-doctor) and `@rakazo/adapters` typecheck fails on
`box-sandbox.test.ts` (`kind: "headless"` not in the provider union). Both
verified present on a stashed clean tree. All counts below are deltas vs that
baseline.

## Cycle A — T40 view-only terminal without the lease (2026-10-11)

- RED `process-pty-wiring.test.ts` "a view-only session drops input frames
  before the live PTY" — `expected [] (writes) to equal []` failed: input
  reached the fake PTY (`fake.writes` got the frame).
- RED same file, reconnected view-only session — same write leak on reconnect.
- GREEN both after: `TerminalRequest.viewOnly?` (adapter-kit), sticky
  `viewOnly` on `PtySessionRecord`, `sendInput` drops text before the handle
  (resize untouched) in `ProcessSandboxProvider.terminalSession`.
  11/11 in the file (2 new), pty-session.test unaffected.
- RED `router.test.ts` "T40: streams the terminal view-only without the lease,
  interactive with it" — status 403 (the old "Take control first." throw) with
  `connectTerminal` uncalled.
- GREEN after: codingSessions.terminalUrl demotes a leaseless caller to a
  view-only URL (`withViewOnly(url, true)`, `controlToken: ""`,
  `viewOnly: true`); capability target `interactive: false`. API suite 624
  passed.

## Cycle B — T41 omp launches inside the terminal (2026-10-11)

- RED `process-pty-wiring.test.ts` "launch command spawns the shell with bash
  --norc -lc" — spawner called with 3 args, no options object.
- GREEN (reconnect test was already green by construction) after:
  `TerminalRequest.launchCommand?`, `PtySpawnOptions {args?, env?}`, the
  spawner seam gains an optional 4th parameter (only passed when a launch
  command exists, preserving existing call arity), node-pty spawner replaces
  its `["--norc"]` default with `spawnOptions?.args`.
- GREEN real-spawn `node-pty-spawner.test.ts` "spawn args replace the default
  argv" — `bash --norc -lc "echo t41-launch-marker"` scrollback contains the
  marker (offline, no omp binary needed).
- RED→GREEN router: `launchCommand: "omp"` for omp sessions; the existing T40
  router test's exact-request assertions extended. API suite 624 passed.

## Cycle C — T42 workspace file RPCs (2026-10-11)

- RED `router.test.ts` "coding session workspace files (T42)" — 5 tests: the
  two happy paths failed with 500 because the procedures did not exist; the
  auth/not-found/stopped-computer assertions failed for the same reason.
  (Debugging note: the first green run still 500'd because the handlers passed
  `(prisma, actor, sessionId)` into `codingSessionComputer(prisma, repos,
  actor, sessionId)` — repos.getBot exploded as `actor.getBot`. Fixed.)
- GREEN after: contracts `codingSessions.listFiles`/`readFile`
  (sessionId + workspace-relative path), shared `codingSessionComputer` gate
  (space-scoped active omp session + running computer; NOT_FOUND / CONFLICT),
  provider `listFiles`/`readFile` with the 2 MB text cap; oversized or
  non-UTF-8 files surface the existing truthful errors. API suite 632 passed
  (631 + skip).

## Cycle D — T43 git graph RPC (2026-10-11)

- RED `coding-git-graph.test.ts` (module missing — suite failed to load), then
  after implementing `buildGitGraph` + `createProcessCommandRunner` wiring:
  fixture repo (git init, two commits, branch, dirty worktree) yields commits
  with sha/parents/subject/author/date, refs main+feature, dirty 1; a non-repo
  yields `{commits:[],refs:[],dirty:0,notRepo:true}`. 2/2 offline via real git.
- RED `router.test.ts` git graph — procedure missing; the notRepo test then
  exposed a fixture bug (six fields where the %H/%P/%s/%an/%aI format emits
  five) before going green.
- GREEN after: contracts `codingSessions.gitGraph`, handler runs read-only git
  argv (rev-parse → log -50 --pretty with unit/record separators, for-each-ref,
  status --porcelain) through `sandbox.execute` inside the session cwd.
  API suite 632 passed.

## Final verification (2026-10-11)

- `@rakazo/adapters` test: 19 failed / 2770 passed — identical failing set to
  baseline; +7 new passing tests (this slice), +6 files passing.
- `@rakazo/api` test: 631 passed / 1 skipped — all green.
- `turbo check` contracts/adapter-kit/adapters/api: only the pre-existing
  `box-sandbox.test.ts` headless-kind error remains (present on clean tree).
- `biome check` on touched files: no new lint/format issues vs clean tree.
