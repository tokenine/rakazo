# 004-code-mode — S6 wiring (T28 + T30) tdd-log

Strict red-green evidence, one entry per cycle. All runs are
`corepack pnpm exec vitest run --root . <file>` inside the worktree unless noted.

## Cycle 1 — T28: wire the PtySpawner handle into the ProcessSandboxProvider TCB

Test file: `packages/adapters/src/process-pty-wiring.test.ts` (7 tests, fake handle — hermetic).

**RED** (before `packages/adapters/src/process-sandbox.ts` changed):

```
 ❯ packages/adapters/src/process-pty-wiring.test.ts (7 tests | 7 failed) 16ms
     × spawner receives the task id and the initial terminal dimensions
     × records spawner output lines into the session scrollback
     × writes text input to the live PTY
     × writes input on a reconnected session to the live PTY
     × propagates resize to the live PTY and updates the session record
     × disposes the live PTY handle when the task is destroyed
     × a failed spawn refuses the terminal and leaves the session operable
 Test Files  1 failed (1)
      Tests  7 failed (7)
```

Representative failure: `expected [Function] to throw error including 'pty spawn failed' but got
'connectTerminal: no task for computer…'` (connectTerminal resolved the task by `computer.id`
instead of `taskIdOf(computer)`, so even the spawner-args test could not reach a task) and
`records spawner output lines… expected [ 'hello', 'world' ]`-style empty-scrollback
assertion failures — connectTerminal discarded the spawner result entirely.

**GREEN** (after the provider wiring edit):

```
 ✓ packages/adapters/src/process-pty-wiring.test.ts (7 tests) 11ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

Neighbor check: `pty-session.test.ts` (7) and `sandbox-factory.test.ts` (5) pass;
`process-sandbox.test.ts` failures match the pre-change environmental set (see EVIDENCE.md —
the T12 settle test was additionally shown to fail on a STASHED clean tree, i.e. not caused
by this change).

Commit: `813c5127` (test + implementation together).

## Cycle 2 — T28: real node-pty spawner + production factory injection

Test file: `packages/adapters/src/node-pty-spawner.test.ts` (4 tests; the real native PTY —
local bash in a throwaway workspace, offline; skipped on win32).

**RED** (before `node-pty-spawner.ts` existed):

```
Error: Cannot find module './node-pty-spawner.js' imported from
  .../packages/adapters/src/node-pty-spawner.test.ts
 Test Files  1 failed (1)
```

**GREEN** (after `createNodePtySpawner` + `sandbox-factory.ts` injection):

```
 ✓ packages/adapters/src/node-pty-spawner.test.ts (4 tests) 328ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Includes the end-to-end proof: `createSandboxProvider("process")` → `connectTerminal` →
`sendInput("echo factory-s6-$((20+22))\n")` → reconnect scrollback contains `factory-s6-42`.

Typecheck after green: `corepack pnpm --filter @rakazo/adapters check` exit 0.
`corepack pnpm install --frozen-lockfile` exit 0 (complete lockfile: adapters importer +
metadata + snapshot all carry `node-pty@1.2.0-beta.15`).

Commit: `55464743` (dependency, spawner, factory injection, tests).

## Cycle 3 — T30: production caller for checkIdle (idle sweep)

Test file: `packages/adapters/src/coding-idle-sweep.test.ts` (6 tests; `sleepComputerIfIdle`
mocked — the sweep only routes into it).

**RED** (before `job-reconciler.ts` changed — `reconcileIdleCodingSessions` did not exist):

```
 ❯ packages/adapters/src/coding-idle-sweep.test.ts (6 tests | 6 failed) 8ms
     × suspends the computer behind an idle coding session
     × skips a session whose bot has no computer
     × skips a session with an active run (checkIdle guard)
     × skips a session with no recorded activity (checkIdle guard)
     × keeps sweeping when one session fails (per-session failures are non-fatal)
     × runs with the periodic sweep and the main scans survive its failure
 Test Files  1 failed (1)
      Tests  6 failed (6)
```

(Six failures at import: `reconcileIdleCodingSessions` was not exported from
`./job-reconciler.js`.)

**GREEN** (after the sweep + reconciler dep + composition wiring), test-harness fixes made
during the green run — noted for honesty, neither touched product code:

1. the `vi.mock`-scoped `sleepComputerIfIdle` spy accumulated calls across tests — added
   `afterEach(() => vi.clearAllMocks())`;
2. the local `publisher()` helper forgot to return `enqueue`, tripping
   `expect(enqueue).toHaveBeenCalledWith(...)`.

```
 Test Files  2 passed (2)      (with job-reconciler.test.ts in the same run)
      Tests  19 passed (19)
```

Typecheck after green: `@rakazo/adapters`, `@rakazo/api`, `@rakazo/worker` `check` all exit 0.

Commit: `06eb0bb0` (sweep + reconciler aux dep + worker/api composition roots + tests).
