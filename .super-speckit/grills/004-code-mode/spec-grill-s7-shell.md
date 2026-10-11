# Spec Grill — Slice 7 workspace shell amendment (R12/R13, T39–T44)

2026-10-11 · Amendment grill on top of the converged 004 grill. Roles independent; each answer
labeled proven (file:line inspected) / inferred / unknown.

## Builder — can we build it with what exists?
Proven: real PTY stack exists end-to-end (xterm.js `LiveTerminal` ⇄ binary WS ⇄ node-pty `bash
--norc`, `node-pty-spawner.ts:24-42`, `process-sandbox.ts:393-432`). Workspace file capabilities
exist (`listFiles`/`readFile`, `process-sandbox.ts:859-896`, path-contained). Routing is declarative
React Router (`App.tsx:23`), full-page non-chat precedent exists (`ArtifactsPage`). Verdict: yes;
the gaps are wiring + auth demotion + one spawn seam extension.

## Examiner — what breaks if we ship the naive version?
View-only via `?view_only=` query is NOT enforced on the PTY path — `terminal-server.ts:93` writes
every kind-0 frame to the fd. Demoting the lease without server-side input dropping would give
unauthenticated-surface write access to the workspace shell. Input must be dropped provider-side,
not in the client. Second: `scrubProcessEnv` is a positive allowlist; granted secrets must never
ride the terminal bootstrap env unless declared via `applySecretGrant` (`process-sandbox.ts:745`).

## Investigator — what is actually true today?
Proven: lease check is `hasActiveComputerControl(...) || controlBotId !== bot.id` → FORBIDDEN
(`router.ts:5681-5687`); `withViewOnly` only sets a query param (`router.ts:7327`); the PTY WS is
provider-internal (`ws://localhost/pty/:id`, `process-sandbox.ts:447`); codingSessions RPC auth =
space-scoped lookup + `repos.getBot`; no git integration exists (CommandRunner subprocess only,
`coding-repo-to-pr.ts:26-44`); production `spawnOmp` throws (`apps/worker/src/index.ts:288-290`).
Unknown: which host process serves the provider-internal /pty WS in the compose stack (proxy hop
not traced) — flagged for implementer to preserve whatever auth that hop already applies.

## Resolver — chosen options (recorded, reversible)
1. **Route** `/app/code/:sessionId` (not per-bot nesting): session id is the aggregate root; the
   view fetches session→bot itself. Reversible: cheap to alias later.
2. **View-only enforcement** in the sandbox provider serve path: drop kind-0 (input) frames when
   the terminal session was created view-only; resize (kind-1) allowed. Lease required to obtain
   a non-view-only URL. Verified by unit test asserting input frames never reach the pty.
3. **omp launch**: extend the `PtySpawner` seam additively with optional `{ args?, env? }` (keep
   `bash --norc` default); codingSessions.terminalUrl gains a bootstrap that runs omp inside bash
   via the session record — no first-input-frame hacks. Secrets only via existing grant store;
   default bootstrap env stays scrubbed.
4. **Files/preview/git** reuse `listFiles`/`readFile` behind codingSessions RPCs (space+bot auth
   via `repos.getBot`); git data via sandbox `execute` git argv, read-only subcommands only.

Scope route: normal (extends milestone 004). Non-goals held: no chat-UI clone for omp, no
mid-session engine change, no file editing/diff depth in this slice.
