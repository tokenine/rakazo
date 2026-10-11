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

## Cycle E — T39 web Chat/Code switch and workspace shell (2026-10-11)

- RED `code-mode-switch.test.tsx` (component missing — transform failed on the
  import). GREEN after `CodeModeSwitch`: segmented Chat|Code control, Code
  reattaches the bot's active session (`codingSessions.list`) or creates one
  with the remembered `rakazo:coding-engine` localStorage value, then navigates
  to `/app/code/:sessionId`. 3/3. Route added in `App.tsx` with the sibling
  auth-guard pattern (lazy page, signed-out → /sign-in).
- RED `CodeWorkspace.test.tsx` (page missing), then implementation: 4/4 —
  rail enables Terminal/Files/Git only when terminalUrl/listFiles/gitGraph
  return content; a leaseless `terminalUrl` (view_only=true in the URL) renders
  the xterm non-interactive (`interactive=false` → `disableStdin`, no focus
  steal); files tree lazy-loads directories and opens a readFile preview;
  git graph renders sha/subject/relative date/refs/dirty and falls back to the
  truthful "Not a git repository." line (the Git panel stays open for it).
- RED rewritten `coding-strip.test.tsx`: pills now navigate to the workspace
  and no longer expand an inline terminal/acceptance card in chat. GREEN after
  `CodingSessionsStrip` became a navigation strip and the acceptance card moved
  to `shell/acceptance-card.tsx`, rendered in the workspace rail.
- Test-infra note: vitest must run through the repo command
  (`corepack pnpm --filter @rakazo/web test`, root `../..`). Running vitest
  from `apps/web` picks up the app vite config and its lingui babel plugin,
  which compiles macro imports to `@lingui/react` and breaks the macro mocks
  ~12 older tests rely on (those failures reproduce on a stashed clean tree;
  not caused by this slice). Under the repo command: 58 files / 369 tests
  passed, tsc clean, production build clean.
- E2E `e2e/code-workspace.spec.ts` (chromium, runs green locally): sign-up →
  onboarding → mock the coding-session RPCs → click the Code control → asserts
  `/app/code/:sessionId`, the rail, the README preview and the git graph, with
  screenshots 01-03 attached.

## Final verification, slice-7 web (2026-10-11)

- `corepack pnpm --filter @rakazo/web test`: 58 files / 369 tests passed
  (2 jsdom `scrollTo` unhandled-error warnings also present on clean HEAD).
- `tsc --noEmit` clean; `vite build` clean (pre-existing chunk-size warning).
- Web e2e for this spec passed locally (chromium project, dev webServer);
  the desktop Playwright suite was left to CI per workspace policy.
