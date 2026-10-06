# 004-code-mode — Slice S6 wiring (T28 + T30) EVIDENCE

Lane: maker, branch `ss/feature/004-s6-wiring` (worktree checked out from integration tip
`0a39f8ac`). Scope = the two independent wiring changes only: T28 (real PTY spawner injected
at the production construction site) and T30 (production caller for `checkIdle`).

Candidate HEAD at lane end: **reported in the lane message as full 40-char SHA**; commits:

1. `813c5127` — feat(004-s6): T28 — wire the PtySpawner handle into the ProcessSandboxProvider TCB
2. `55464743` — feat(004-s6): T28 — real node-pty spawner injected at the production factory
3. `06eb0bb0` — feat(004-s6): T30 — production caller for checkIdle via the periodic reconciler sweep
4. evidence commit (this file + tdd-log.md + tasks.md note updates)

## T28 — what changed and the exact seams

- `packages/adapters/src/process-sandbox.ts`
  - New exported `PtyHandle` interface next to the existing `PtySpawner` type: required
    `dispose()`, optional `write(data)`, `resize({cols,rows})`, `onData(listener)`. Optional
    members keep the S5 no-op stub a valid `PtySpawner`. The `PtySpawner` signature itself
    (`taskId, cols, rows`) is unchanged.
  - New private `ptyHandles: Map<sessionId, PtyHandle>` alongside the S5 `ptySessions` registry.
  - `connectTerminal` now: resolves the task via `taskIdOf(computer)` (the same helper every
    other provider method uses — it previously used `tasks.get(computer.id)`, which never
    matched a provisioned ref `id: "process-<taskId>"`), captures the spawner's returned
    handle, registers its output listener so lines flow into the TCB scrollback via the
    existing `recordScrollbackLine` (re-reading the record from the map per line because
    `resizePtySession` replaces the map entry), and wires `sendInput` → `handle.write`,
    `resize` → `handle.resize`, and `destroy` → `handle.dispose()` + handle/record cleanup.
    A failed spawn deletes the session record before rethrowing (no half-registered session).
    With a live `write` path the S5 `$ ${text}` placeholder echo is skipped — a real PTY
    echoes input itself; the placeholder remains when no handle is wired so the TCB stays
    unit-testable with the no-op stub.
  - New exported `processTaskRootDir(root?)` — one source of truth for the task-tree root
    shared by the provider's `rootDir()` and the spawner (was a private default).
- `packages/adapters/src/node-pty-spawner.ts` (new)
  - `createNodePtySpawner({ root? })` returns a `PtySpawner`. It spawns `bash --norc` in the
    task's workspace tree (`processTaskRootDir` + `taskWorkspaceDirName` — same primitives the
    provider uses) with the scrubbed parent env (`scrubProcessEnv(process.env)`; PATH/HOME/
    TMPDIR/LANG/LC_ALL/TERM only). `--norc` keeps host shell rc configuration out of the task
    runtime — the same hermetic posture as the spawn-env scrub. Chunks are split into complete
    lines (CRLF trimmed); output emitted before the listener attaches is buffered and flushed
    on attach. POSIX-only, matching the provider's bash-based `execute()`.
  - node-pty is loaded LAZILY with dynamic `import()` INSIDE the spawner — the repo's reserved
    deferred-loading case: offline tests, non-PTY providers, and module load never touch the
    native binary. The module imports node-pty only as a top-level `import type { IPty }`.
- `packages/adapters/src/sandbox-factory.ts`
  - The `SANDBOX_PROVIDER=process` production branch now passes
    `ptySpawner: createNodePtySpawner({ root: opts.dataDir })`. Tests construct
    `ProcessSandboxProvider` directly and keep the no-op default.
- `packages/adapters/package.json` + `pnpm-lock.yaml`
  - `node-pty@1.2.0-beta.15` (exact) added to `@rakazo/adapters`.

### node-pty version decision (1.1.0 stable is broken on macOS)

`node-pty@1.1.0` (npm `latest`) fails every spawn on macOS with `Error: posix_spawnp failed.`
— reproduced directly with node, outside the app. Root cause: the 1.1.0 tarball ships
`prebuilds/darwin-*/spawn-helper` WITHOUT the executable bit (`-rw-r--r--` in the published
tarball, verified by unpacking it), and neither node-pty's `install` nor `postinstall` script
fixes the mode; node-pty's macOS spawn path execs that helper. `chmod +x` on the installed
helper made 1.1.0 work, proving the diagnosis. `node-pty@1.2.0-beta.15`'s tarball ships the
helper with mode 755 and its spawn/resize/kill API is identical, so the dependency pins the
beta rather than carrying a vendored patch or chmod postinstall plumbing.

### T28 declared limitation (unchanged, per scope)

`ptySessions`/`ptyHandles` remain in-memory: session identity is NOT preserved across
provider restart. Persistence is out of scope for S6.

### T28 boundary NOT covered by this slice (pre-existing, untouched)

The API surface (`apps/api/src/router.ts` terminalUrl) resolves terminals through
`toComputerRef(computer)`, whose `id` is the DB `providerRef` (for a process computer, the
workspace dir path). `connectTerminal` resolves tasks by `taskIdOf(computer)` ("process-<id>"
or bare id), so a DB-derived process-computer ref still does not match a task context. This
id-resolution gap predates S6 (the same gap affects the provider's other methods), is outside
the S6 scope (spawner injection), and is recorded here rather than silently papered over.

## T30 — what changed and the exact seams

- `packages/adapters/src/job-reconciler.ts`
  - New exported `reconcileIdleCodingSessions(deps)` with deps `{ prisma, sandbox, home,
    jobs, events }`: enumerates `codingSession.findMany({ where: { status: "active" } })`,
    calls the existing `checkIdle` (via `createSessionServiceDeps`) per session, and for idle
    sessions resolves the computer through `session.botId → bot.computerId` — the same
    mapping the T38 `reconcileCrash` path in `background-job-handlers.ts` uses — then invokes
    the existing `sleepComputerIfIdle`. Explicit skip paths: checkIdle's own guards (session
    not active, active run, no `lastActivityAt`) and no `botId`/no `bot.computerId`. Per-session
    failures are logged via `getLogger().error("idle coding-session sweep", error)` and the
    sweep continues.
  - `createJobReconciler` gains an optional `reconcileIdleCodingSessions?: () => Promise<void>`
    dep, run in the existing auxiliary `Promise.allSettled` block alongside
    `reconcileCloudAgents`/`reconcileComputerUpdates` (same error handling: a rejection is
    logged and never blocks the main scans).
- `apps/worker/src/index.ts` and `apps/api/src/app.ts` (the two production composition roots)
  - Wire `reconcileIdleCodingSessions: () => reconcileIdleCodingSessions({ prisma, sandbox,
    home, jobs, events })` into their `createJobReconciler` calls.
- `run.continue`'s existing deadline/budget/activity gating is untouched.

## Tests

New test files (all red-first; see tdd-log.md for per-cycle red/green transcripts):

- `packages/adapters/src/process-pty-wiring.test.ts` — 7 tests (fake handle; scrollback,
  input write, reconnect input, resize, dispose-on-destroy, spawner args, failed-spawn).
- `packages/adapters/src/node-pty-spawner.test.ts` — 4 tests (real PTY: output lines, resize
  via `stty size`, double-dispose quiet, end-to-end factory injection echo). win32-skipped.
- `packages/adapters/src/coding-idle-sweep.test.ts` — 6 tests (idle suspend routed, no-computer
  skip, active-run skip, no-activity skip, per-session failure non-fatal, reconciler aux run
  + main scans survive).

### Counts: baseline vs after

Baseline (pre-change, after the standard `pnpm --filter @rakazo/db generate` setup step,
without which 52 files fail to load on this host — environmental, pre-existing):

- `packages/adapters`: `Test Files 6 failed | 191 passed | 5 skipped (202)`, `Tests 18 failed | 2708 passed | 2 skipped (2753)`

After (identical machine):

- `packages/adapters`: `Test Files 6 failed | 194 passed | 5 skipped (205)`, `Tests 18 failed | 2725 passed | 2 skipped (2770)`

The failing-test set is IDENTICAL line-for-line to the baseline (`diff` of the FAIL lists is
empty): all 18 are the known environmental set (`coding-doctor` ulimit -v on macOS,
`coding-omp-protocol` node spawn ENOENT, `coding-secrets-flow`, `process-collision-matrix`,
`process-sandbox-secrets`, `process-sandbox` ulimit/nice/scrub/daemon). Net: +17 new tests,
all passing, zero new failures.

Spot-run: `packages/api` (`@rakazo/api test`) — `39 passed | 1 skipped (40)` files,
`611 passed | 1 skipped (612)` tests, exit 0.

### Verification checklist (actual results)

1. `corepack pnpm install --frozen-lockfile` — exit 0 (lockfile carries the adapters importer
   entry for node-pty; this was checked explicitly given the earlier truncated-lockfile rejection).
2. Typecheck — `corepack pnpm check` (turbo, whole workspace): 24/24 tasks successful, exit 0;
   per-package `check` also run for `@rakazo/adapters`, `@rakazo/api`, `@rakazo/worker` during
   the cycles.
3. New tests green (17/17); full `packages/adapters` suite with no new failures vs baseline;
   `packages/api` spot-run green.
4. node-pty builds/installs in this environment (prebuilds; no node-gyp compile needed) —
   T28 delivered in full; no blocked half.

### Flakiness note (pre-existing, not caused by this change)

`process-sandbox.test.ts > an aborted in-flight command settles … (T12 wiring)` passed in the
baseline full-suite run but fails at ~8 s on this host when the file is run alone or in small
batches — verified by `git stash -u` + re-run on the CLEAN tree (same failure without any of
this change). It is a timing-sensitive settle test on this host, unrelated to S6.

## Assumptions

- The change story file contains no "Slice S6" section; the lane task text's SCOPE section
  (T28 + T30 as quoted) was treated as the approved scope.
- The idle sweep re-checks each session via `checkIdle`'s own row lookup rather than trusting
  the `findMany` projection, so stale activity between enumeration and decision still gates.
