# 004-code-mode S2 — TRACKING (fix round 1: LOW-6 / LOW-7 / LOW-8)

Recorded by lane `rakazo-004-s2-fix-r1` at 2026-10-01 (base a8788440, branch
tl/004-purpose-gate-r1). These are tracking notes only — no code changes — so
the checker findings are not silently dropped.

## LOW-6 — process-provider session-start wiring is NOT wired yet (deferred to S5/Q7)

`ProcessSandboxProvider.createTaskContext` (packages/adapters/src/process-sandbox.ts)
has ZERO production call sites today — only tests and `provision()`'s implicit
fallback path call it. The D-Q9 lifecycle comment ("the task context is created
at session start from the setup definition") describes the TARGET state; the
actual session-start wiring (reading the Q7 setup definition and calling
`createTaskContext` with the task's declared env + limits) does not exist yet.
The in-code comment points at the deferral: "The full Q7 setup format lands in
S5/T27; this is the runtime-facing shape it feeds today."

STATUS: DEFERRED to Slice 5 / Q7 per that comment. Must not be silently
dropped: S5 must either wire session-start `createTaskContext` (so declared
task env and per-task limits actually flow from the setup definition) or
explicitly re-scope the D-Q9 lifecycle claim.

## LOW-7 — S3 constraint: per-command `request.env` must never bypass grant/audit for secrets

In `execute()` (process-sandbox.ts) the spawned env is
`scrubProcessEnv(process.env, { ...task.env, ...request.env })`. The scrub's
positive-selection allowlist (process-env-scrub.ts `PROCESS_ENV_SCRUB_ALLOWLIST`)
applies ONLY to the parent environment; everything in the second argument
(task-config declared vars + per-command `request.env`) passes as "declared"
wholesale, with `request.env` winning over `task.env`.

Constraint for Slice 3 (secrets subsystem, Q10): per-command `request.env`
must NEVER become a channel that re-injects a granted secret (or any
grant-gated value) into a command's environment without the grant and audit
checks. Today a command could pass `request.env = { ANY_KEY: ... }` and it
would reach the child un-scrubbed. S3 must either strip/deny grant-gated key
names from `request.env` or route any secret-bearing key through the
grant/audit path before it reaches `scrubProcessEnv`'s declared-vars argument.

## LOW-8 — stale sibling claim `COMPUTER_SCREEN_UNAVAILABLE` (deferred: apps/web is behind the T6 design-first gate)

`packages/adapters/src/computer-screens.ts:5` still says "File and shell tools
still work." inside `COMPUTER_SCREEN_UNAVAILABLE`, and
`apps/web/e2e/computer-screen-error.spec.ts:33` asserts that exact string.
The correcting change requires touching `apps/web` (e2e assertion + any
surface that renders the constant), which is behind the T6 design-first gate
— so the wording is deferred, NOT silently accepted. Per the checker this is
not a live regression.

STATUS: DEFERRED. When the T6 gate opens, fix the message text and the e2e
assertion together (they must not drift again).
