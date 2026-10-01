# Feature 004 — Code mode (Rakazo Code)

Status: specified · grilled 2026-10-01 (r1) · design decided (Q9+Q10) 2026-10-01 · plan drafted, pending human approval gate
Base commit: c2e6bb119fd38a25e11b68158ea69a065be8d899 (`integration/001-multi-session-agents`)
Purpose: confirmed 2026-10-01 by the user (Poom5741) — `.super-speckit/purpose/004-code-mode/decision.json`
Grill: `.super-speckit/grills/004-code-mode/spec-grill.md` (amendments below are grill resolutions)

## Problem

Rakazo can run a Pi agent inside a Team Computer folder, but that is not a development
workspace. Verified gaps (all citations re-verified at c2e6bb11; Examiner re-audit 2026-10-01
found no wrong citations):

- Team Computer folders share one security boundary and do not establish project isolation
  (`docs/computer-runtime.md:34` — shared OS user, workspace, browser profiles), so concurrent
  or hostile workloads are not separated.
- Workspace persistence is latest-only and **no revision archive exists at all**: commit keeps a
  single `homes/<botId>` copy and deletes `.previous` (`packages/adapters/src/home.ts:57-82`),
  `home.restore` ignores the requested revision (`:86-93`), and `copyDir` overwrites without
  read-before-write (`:315-338`); for docker/cloudflare, checkpoint only bumps a stamp
  (`computer-workspace.ts:96-100`). A restore can clobber later manual edits.
- User takeover does not pause state-changing workspace tools: desktop/screen tools check
  `heldForTakeover` (`packages/adapters/src/executor.ts:2334`, `:2345`, `:2604`, `:2632`,
  `:2682`) but **shell** (`:2568` — only the desktop-protection guard `:2570-2574`),
  **write_file** (`:2424-2436` — marks the workspace dirty with no guard), **schedule_create**
  (`:2761`), and **add_mcp_server** (`:2865`) run unguarded.
- There is no reconnectable terminal: `ProcessEvent` is stdout/stderr/exit only
  (`packages/adapter-kit/src/interfaces.ts:102-106`, `types.ts:73-76`); `SandboxCapabilities.pty`
  is declared (`types.ts:68`, `:173`) and written by eight real sandbox providers plus the
  `fake-sandbox` test double (e.g. `docker-sandbox.ts:118`) but read nowhere.
- Preview routing, engine selection, coding-engine credentials/approvals, and budgeted unattended
  work are not modeled for coding sessions.

Users who want an agent to implement a feature in a real repository — then inspect, verify, and
PR it — have no supported path.

## Requirements

Scope of the first supported journey: an **existing Linux-compatible JavaScript/TypeScript web
repository** (monorepos and development services included). Other stacks may open, with
unsupported environment requirements disclosed explicitly.

1. **R1 — Repository-to-PR with each engine.** From a configured repository, user and agent agree
   an outcome — "agree" is concrete: a recorded acceptance artifact, gated before the agent's
   first edit. The agent implements and verifies; the run ends with an inspectable diff, reported
   verification evidence (command, exit status, evidence artifact), and a reviewable pull request —
   all within granted permissions.
2. **R2 — Two engines, fixed per session.** Normal Pi and OMP (OMP = a fork of Pi; research §1,
   `omp.sh/docs/sdk`, `omp.sh/docs/rpc`) are selectable at session creation (default normal Pi for
   first-time users; most recent choice remembered per user; engine selection shown separately
   from model selection). Both expose prompt, steer, stop, resume, inspect changes, and approvals.
   Unsupported operations are surfaced as such — never a silent engine switch. Changing engine
   mid-session is impossible; a new session created via explicit continuation MAY select the other
   engine — it must be labelled as an engine change and carry the handoff summary (R8); never
   silent or automatic.
3. **R3 — Normal Pi is a complete coding workflow.** Project instructions, file editing, commands,
   context management, resumable sessions — by reusing existing Rakazo capabilities; re-prompting
   the general assistant does not qualify.
4. **R4 — Project isolation and concurrency.** Concurrent coding tasks run in separate workspaces,
   branches, and execution state with no collisions in files, processes, service data, or ports.
   For verification, collision classes are enumerated: listening ports, process names,
   database/service names, volumes/directories (fixture matrix in plan). Changes integrate
   explicitly rather than via last-writer-wins. The isolation mechanism (separate computers vs
   in-computer namespacing) is decision Q9 — open before plan.
5. **R5 — Reproducible project setup.** A reviewable definition (dependencies, setup commands,
   development services, verification commands) that re-runs to reproduce the environment; the
   agent may propose changes to it. Replacing the environment reproduces setup and truthfully
   reports services that need restart — "needs restart" is observable: a service process from the
   setup definition that is not live after the replace, reported against the definition.
6. **R6 — Workspace interaction.** File navigation, project search, text editing, diffs,
   reconnectable terminals (input + resize — this requires adapter-kit interface extension:
   pty session identity, resize/replay events, attach; today's `execute` is fire-once), and
   development previews that are private and authenticated by default; sharing is explicit and
   revocable, and distinct from production deploy.
7. **R7 — Takeover and checkpoint safety.** Manual edits and state-changing commands require
   explicit takeover: pause execution, settle active operations — settle is observable: signal,
   bounded wait, recorded exit — across ALL unguarded state-changing handlers (shell
   `executor.ts:2568`, write_file `:2424-2436`, schedule_create `:2761`, add_mcp_server `:2865`),
   and recheck workspace changes before the agent resumes; neither party's work is silently
   overwritten. Checkpoint restore honors a selected revision and protects subsequent manual
   edits. This requires a versioned workspace store, which does not exist today
   (`home.ts:57-82`, `:86-93`) — it is in-scope build work, not a parameter fix.
8. **R8 — Continuity.** Server-owned work continues within configured limits when a client
   disconnects; clients reconnect to the existing session with pending approvals waiting; after a
   crash, actual outcomes are reconciled before retry — reconciliation is observable: the
   workspace dirty-set plus the last recorded action (made concrete in plan). Explicit
   continuation into a new session (same workspace, optional handoff summary; engine change only
   when labelled per R2) stops the original run first and preserves original history;
   engine-internal runtime state is never translated across engines as if interchangeable.
9. **R9 — Budgets, failure, checkpoints.** Files and task history persist; idle compute suspends
   ("idle" = no active run and no user interaction for a configured period; defaults set in plan);
   unattended work is bounded by configurable budgets and deadlines. Failures preserve work and
   report the blocker, attempted verification, and the smallest action needed to continue
   (action must be a concrete system-proposed command or decision request); stopped execution
   never implies success. Checkpoints are not universal undo — external side effects (DB,
   deploys) need separate recovery semantics, reported truthfully.
10. **R10 — Secrets and authorization.** Project secrets are configured in Rakazo settings and
    injected scoped to the relevant environment or operation; values are excluded from prompts,
    transcripts, checkpoints, and handoff summaries — exclusion must survive encoded forms (see
    V8). Missing credentials are blockers, never permission to bypass access controls. Engine
    selection grants no additional access; Rakazo owns credentials and authorization for both
    engines. **Grill flag:** env/file injection for project secrets currently conflicts with
    `docs/bot-secrets.md`; revising that boundary requires an explicit recorded decision before
    plan (Q10) — not a silent override.
11. **R11 — Surfaces.** Web and Electron provide the full workspace; app and CLI attach to the
    same server-owned session. No CLI package exists today (`apps/` = api, cf-bridge, desktop,
    mobile, web, worker, www) — the CLI is a new surface, sequenced after web per A4. Mobile
    exposes an enumerated set of applicable workflows (conversation, steering, approval, preview,
    review as applicable — list fixed in the step-4 slice plan). Self-hosted Linux server
    execution first.

## Non-goals (from the confirmed purpose map)

- ZCode is a functional benchmark only — no visual parity, no feature-for-feature parity; Rakazo
  keeps its own interface and design system.
- No debugger UI, extension compatibility, or advanced refactoring initially.
- No promise that arbitrary processes survive suspension; checkpoints are not universal undo.
- No silent engine substitution; engine selection grants no access.
- Unsupported environment requirements (native builds, other stacks) are disclosed, not silently
  attempted as supported.
- No runtime migration is selected by this feature; architecture decisions are recorded only after
  their tradeoffs resolve.

## Product assumptions made autonomously (reversible)

- **A1:** a coding session = the existing run/session machinery bound to (workspace, engine) at
  creation — no new database engine in v1. (Grill clarification: the versioned workspace store
  required by R7 is a file-revision archive, in scope; A1 rules out a new *database*, not
  versioned file storage.)
- **A2:** v1 acceptance centers on one complete repository workflow (discovery delivery step 3)
  before takeover/handoff/mobile completeness claims (step 4); the milestone route slices in that
  order.
- **A3:** PR creation uses the permissions already granted to the workspace credential; no new
  authorization model in v1.
- **A4 (grill):** CLI and full mobile completeness are sequenced after the web
  repository-workflow slice; v1 core acceptance runs on web.

## Open questions (for grill / plan)

- Q1: Does OMP ride the existing sandbox `execute` seam or need a process-boundary RPC adapter?
  How do approvals, sandbox placement, credential mapping, and recovery attach? (research §1;
  grill: inferred RPC sidecar inside the sandbox — SDK requires Bun, server is Node; settle by
  spawning `omp --mode rpc` inside the sandbox before engine adapter work)
- Q2: How do approvals attach for OMP's built-in tools (bash/edit)? RPC documents host-owned
  tools and extension-UI confirm but no builtin permission gate. (grill: unknown — settle via OMP
  docs or the Q1 experiment)
- Q3: Durable coding-session entity and workspace ownership — no engine field, engine dispatch,
  or workspace-lease ownership exists today; two runs must never own one workspace. (grill:
  inferred gap — schema/ownership decision in plan)
- Q4: Takeover settle semantics (signal/wait/kill policy) and the pre-resume workspace recheck
  mechanism. (grill: gap proven, policy unknown — design decision in plan)
- Q5: Checkpoint contents (node_modules? dev-service data? process state?), retention, and
  manual-edit conflict detection. (grill: gap proven, contents unknown)
- Q6: Concrete budget/deadline defaults; idle-suspend contract for dev processes. (grill:
  inferred gap — product defaults needed)
- Q7: Setup-definition format (evaluate an existing standard such as devcontainer.json vs
  custom) and service lifecycle. (grill: unknown — greenfield today)
- Q8: Mobile v1 workflow enumeration. (grill: inferred — A2 step 4)
- Q9 (grill): Isolation execution environment for concurrent tasks — separate computers vs
  in-computer namespacing (docker) — cost/quota tradeoff; `docs/computer-runtime.md:34` says
  team bots share the OS user today. RESOLVED 2026-10-01 (user, via Chief): docker on the existing team box — one host-side
  action required first (restricted docker socket recommended; seccomp blocks CLONE_NEWUSER
  from inside). `.super-speckit/design/004-code-mode/decision.json` + design-brief.md D-Q9.
- Q10 (grill): Secrets-boundary revision — R10's scoped injection vs `docs/bot-secrets.md`'s
  explicit refusal to expose credential injection into shell/files/env. Explicit recorded
  decision required before plan. RESOLVED 2026-10-01 (user, via Chief): Option B — scoped,
  audited injection allowed (R10 wins); docs/bot-secrets.md superseded for this feature as a
  documented carve-out. `.super-speckit/design/004-code-mode/decision.json` + design-brief.md
  D-Q10.

## Verification sketch (matrix rows to expand)

- **V1 Engine conformance (offline, deterministic):** each engine's session events, approvals,
  steering, stop, and recovery proven through its adapter; distinguishes a labelled cross-engine
  continuation from a silent switch. Gated on Q1/Q2 for OMP.
- **V2 Repository-to-PR E2E per engine** on a fixture repo: recorded acceptance criteria met,
  diff inspectable, PR openable; evidence captured.
- **V3 Concurrency:** two tasks, one bot — assert zero collisions across the enumerated classes
  (ports, process names, service/db names, volumes) in the Q9 execution environment.
- **V4 Takeover round trip:** manual edit during takeover survives agent resume; in-flight shell
  AND write_file during takeover are settled or blocked (G1 scope); neither side's work lost.
- **V5 Checkpoint restore:** selected revision restored from the versioned store; later manual
  edits preserved; external actions not implied rolled back.
- **V6 Disconnect/reconnect + crash:** pending approval waits; no duplicate run; reconciled
  outcome (dirty-set + last recorded action) after crash.
- **V7 Previews:** private by default; grant + revoke enforced; sharing ≠ deploy.
- **V8 Secrets:** scoped injection; values absent from prompts, transcripts, checkpoints, and
  handoff summaries — asserted by literal AND transform sweep (base64/hex/URL-encoded forms of
  the secret) grepped over all artifact surfaces.
