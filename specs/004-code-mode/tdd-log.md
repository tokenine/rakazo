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

## Cycle F — review repair B1: view-only demotion on reconnect (2026-10-11)

- RED `process-pty-wiring.test.ts` "B1: a view-only reconnect demotes an
  interactive session and the demotion is sticky" — failed against the
  creation-time-only `record.viewOnly` enforcement: an interactive session
  reconnected with `viewOnly: true` kept writing to the live PTY.
- GREEN in `process-sandbox.ts`: the reconnect branch demotes the sticky
  session record on ANY reconnect carrying `viewOnly` (`existing.viewOnly =
  true`). The invariant now tested: after a view-only reconnect, no input ever
  reaches that PTY again — a later `viewOnly: false` reconnect on the same
  sessionId returns the demoted session and still drops input; write access is
  only regained by spawning a NEW session, which requires the control lease at
  the API layer (comment states the constraint in the source).
- Adapters suite after the fix: 19 failed / 2771 passed — identical to the
  recorded environmental baseline.

## Cycle F (cont.) — review repair B2: truthful gate for non-enforcing terminal providers (2026-10-11)

- Repair choice recorded (option b): the desktop/daytona/e2b adapters hand out
  raw interactive terminal URLs (VNC control port) and have no per-keystroke
  server-side input channel to drop, so a shared sticky-drop conformance test
  cannot be honest for them. Instead the API now gates
  `codingSessions.terminalUrl` on a new provider-neutral capability,
  `SandboxCapabilities.viewOnlyTerminal` (declared only by
  ProcessSandboxProvider): a leaseless request against a provider without the
  capability returns the truthful `{ url: null,
  reason: "terminal not supported for this computer" }` and never calls
  connectTerminal. Leased (interactive) use is unchanged for every provider,
  so no desktop/daytona/e2b regression.
- RED `router.test.ts` "B2: leaseless view-only terminals are refused on
  providers that cannot enforce view-only" — the pre-fix router called
  connectTerminal and returned an interactive URL for a capability-less
  provider. GREEN after the capability + gate + contract `reason` field.
  Api suite: 632 passed / 1 skipped; touched-package tsc clean except the
  pre-existing `box-sandbox.test.ts` SandboxKind literal error that also
  fails on clean HEAD.

### Cycle G — live journey on the review stack (2026-10-11, docker sandbox)

Stack: api+worker+web restarted at candidate code (SANDBOX_PROVIDER=docker, real
rakazo/computer:local image). Driven in a real browser against the real app.

- V22 live PASS: one visible Code switch on the bot header → /app/code/:sessionId navigation →
  workspace shell with rail (Terminal/Files/Git) + acceptance card; pills navigate; back link
  returns to chat. Screenshots in session artifacts.
- V18b live PASS (docker semantics): leaseless terminalUrl → {url:null,
  reason:"terminal not supported for this computer"} (B2 gate, truthful refusal on a provider
  that cannot enforce view-only); with the computer-control lease → interactive URL; typed
  `which omp` + Enter round-tripped input/output in a REAL bash (`rakazo@<container>:~/bots/<botId>$`).
- V24 live PASS: Files panel lists the real container workspace root (.browser-profiles, .cache,
  .config, .local, bots, shared); directory navigation + expand states work via the new RPC.
- V25 live PASS (empty state): Git panel renders "Not a git repository." truthfully for the
  non-repo workspace; populated-graph rendering still only e2e-mocked.
- V23 BLOCKED live: omp did not auto-launch. Two causes: (1) omp is not installed in the
  rakazo/computer image; (2) the docker/supervisor terminal path does not apply the
  launch-command seam (only ProcessSandboxProvider's node-pty spawner does). Filed as
  .super-speckit/bugs/omp-launch-docker-path.md.

Live defects found and dispositioned during the journey:
- Computer entrypoint crashed on any host that maps its own uid into the container (dbus-launch
  with no passwd entry + set -u) — FIXED a43ab1b2, image rebuilt, computer boots (exit 0 on
  graceful stop only).
- Wake-then-resleep: the coding-session idle sweep (per-session idleThresholdMinutes, default 30,
  reconciler tick 30s) re-parks a manually woken computer within one tick — no minimum-awake
  guard. Workaround applied for the journey (idleThresholdMinutes raised on active sessions).
  Filed as .super-speckit/bugs/wake-resleep-idle-sweep.md.

### Cycle H — omp launch on the docker terminal path (2026-10-11)

Bug: .super-speckit/bugs/omp-launch-docker-path.md. The docker/supervisor terminal path
ignored the coding session's launchCommand, and the computer image shipped no omp/pi.

- RED (core commands): desktop-runtime.test.ts "hands the launch command to a fresh terminal
  server and never to a reused one" + "shell-quotes the launch command so metacharacters cannot
  break out" — both failed before the change (spawn line had no fifth argv; hostile string
  absent). GREEN after startTerminalCommand/terminalCommand gained an optional launchCommand,
  shell-quoted via shellQuote into the python spawn argv (fresh-spawn branch only; reconnect
  asserted unchanged). bash -n sanity included in the hostile case.
- RED (python server): terminal-server.test.ts "types an optional launch command into the
  initial shell once" failed (output never contained the command). GREEN after the server takes
  an optional 4th positional argv and writes `<launch>\n` to the pty once per new shell — same
  write path as user keystrokes, no protocol change. First green attempt failed because the
  `\n` inside the embedded TS template literal became a real newline in the Python source
  (every terminal-server test then failed to parse); fixed to `\\n` and all green.
- RED (supervisor): index.test.ts "rejects terminal launch commands that are not a safe plain
  command" failed — invalid launchCommand reached the Docker path (500). GREEN after the route
  body gained launchCommand: z.string().max(256).regex(/^[A-Za-z0-9_@%+=:,./-]*$/) with the
  parse moved inside the route try so rejections answer 400 (first green attempt still 500
  because the parse sat outside the try). terminalCommand receives the validated value.
- RED (adapter): docker-sandbox.test.ts "forwards the terminal launch command to the
  supervisor" failed (body lacked launchCommand). GREEN after connectTerminal sends
  {controlToken, cwd, launchCommand: request.launchCommand ?? ""}; viewOnly stays unforwarded
  with a comment pointing at the B2 capability gate.
- Image: Dockerfile installs @oh-my-pi/pi-coding-agent@18.6.1 and
  @earendil-works/pi-coding-agent@1.1.0 (exact pins) into the root-owned /usr/local npm prefix
  (runtime only executes, host-mapped uid never installs). omp 18.6.1 verified Bun-only by
  inspecting the published tarball: 494 `Bun.*` call sites, so the shebang cannot be rewritten
  to node — a pinned Bun 1.3.14 binary (TARGETARCH-mapped x64/aarch64) is installed instead.
  pi (earendil fork, maintained successor of @mariozechner — reversible choice) runs on the
  existing node 22. Image rebuilt as rakazo/computer:local; in-image smoke via
  `docker run --rm --entrypoint sh` printed omp/18.6.1, 1.1.0 (pi), 1.3.14 (bun), v22.23.3.
- Verification: core suite 655 passed; docker-sandbox 23 passed; supervisor suite green except
  4 pre-existing computer-loopback environmental failures (reproduced on a clean tree);
  adapters suite 18 failures vs the 19 environmental baseline, all in untouched
  spawn/platform-specific specs; core/adapters/supervisor tsc clean except one pre-existing
  box-sandbox.test.ts error. Supervisor endpoint parsing is covered by the boundary rejection
  test (loopback-to-Docker full-path unit skipped: the route needs a real container).

### Cycle I — omp model setup on the docker terminal path (2026-10-11)

The terminal auto-launches omp but shows no-model: the container has none of the bot's
provider credentials. Design: the secret travels only as supervisor process env (inherited
by the terminal server's pty child — terminal-server.py identity() copies os.environ
unfiltered, so no core change was needed); omp's models.yml names the env var, never the
key, so checkpoint scope is irrelevant to secret exposure.

- RED (supervisor): index.test.ts endpoint tests for env (bad key shapes, 17 keys, 4KB+
  values) and homeFiles (absolute, `..`, non-.omp, >8KB, 9 files) all failed before any
  implementation; terminalHomeFilesCommand unit tests failed (function missing). GREEN:
  zod body gained bounded `env` (key regex, ≤16, ≤4096) and `homeFiles` (≤8, ≤8KB), merged
  into runContainerCommand env / a pre-launch shell stanza; terminalHomeFilesCommand
  enforces the under-~/.omp path policy again and writes umask 177. First green attempt
  had one wrong assertion (shellQuote emits a real newline, not `\n`).
- Core: no change — verified the pty child inherits the full command env (read +
  terminal-server/desktop-runtime suites green). Committing a leftover from Cycle H live
  verification: the `time` import and prompt-wait in the terminal server program were
  uncommitted; HEAD could not have launched omp at all without it.
- RED (adapter): docker-sandbox.test.ts expected env/homeFiles in the terminal body.
  GREEN: TerminalRequest gained optional env/homeFiles; docker forwards both; the process
  provider is unchanged (its spawn env already passes through locally).
- RED (adapters): omp-terminal.test.ts — native mapping, custom route, oauth refusal,
  keyless refusal all failed (module missing). GREEN: ompTerminalInjection maps only
  unambiguous api-key provider ids to omp's bundled providers (anthropic, openai, google,
  deepseek, openrouter, groq, mistral, xai, cerebras, together, fireworks,
  zai-platform→ZAI_API_KEY); everything else with a usable key and base URL takes omp's
  custom-provider route (provider "rakazo", apiKey: RAKAZO_OMP_API_KEY); oauth and keyless
  inject nothing. Rakazo's "zai" id (coding-plan endpoint) deliberately takes the custom
  route because omp's bundled "zai" is the regular platform endpoint.
- RED (api): router.test.ts terminalUrl tests asserting env present with the key value,
  models.yml containing the env NAME but not the key, and oauth → no env. GREEN:
  ompModelTerminalInjection reuses findModelCredential (packages/db model-credentials.ts,
  the same accessor ai-consent uses for a bot's selected model) plus deps.secrets.load;
  unreadable credentials and missing selections inject nothing and the terminal still
  opens with bare `omp`. First run failed on the B2 gate (needed viewOnlyTerminal: true
  in the fixture), then on homeFiles `[]` vs undefined (native route sends no file).
- Verification: supervisor suite green except the 4 known computer-loopback environmental
  failures; docker-sandbox 23 passed; omp-terminal 6 passed; router.test.ts 100 passed;
  core suite green; api/core/adapter-kit/supervisor tsc clean; adapters tsc has the one
  pre-existing box-sandbox.test.ts error (reproduced on a clean tree); adapters suite has
  the same 18 environmental failures as the clean tree.
- Known limitations: oauth-kind credentials (ChatGPT/Codex subscriptions, Claude plans)
  cannot be seeded — omp's own /login is required and the terminal truthfully shows
  no-model. omp model ids may drift from pi catalog ids; a mismatch leaves omp on its
  picker rather than failing the terminal. The process provider ignores request.env.
