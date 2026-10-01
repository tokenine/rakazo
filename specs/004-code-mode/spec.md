# Feature 004 — Code mode (Rakazo Code)

Status: specified · grill pending
Base commit: c2e6bb119fd38a25e11b68158ea69a065be8d899 (`integration/001-multi-session-agents`)
Purpose: confirmed 2026-10-01 by the user (Poom5741) — `.super-speckit/purpose/004-code-mode/decision.json`

## Problem

Rakazo can run a Pi agent inside a Team Computer folder, but that is not a development
workspace. Verified gaps (all citations re-verified at c2e6bb11, see the research matrix):

- Team Computer folders share one security boundary and do not establish project isolation
  (`docs/computer-runtime.md`), so concurrent or hostile workloads are not separated.
- Workspace persistence is latest-only: `home.restore` ignores the requested revision and
  `copyDir` overwrites without read-before-write, so a restore can clobber later manual edits
  (`packages/adapters/src/home.ts:86-93`, `:315-338`; single overwritten revision stamp `:171-177`).
- User takeover does not pause the shell: state/screen-changing tools check `heldForTakeover`
  (`packages/adapters/src/executor.ts:2334`, `:2345`, `:2604`, `:2632`, `:2682`) but the shell
  handler applies no such guard (`:2568`, only the desktop-protection guard `:2570-2574`).
- There is no reconnectable terminal: `ProcessEvent` is stdout/stderr/exit only
  (`packages/adapter-kit/src/interfaces.ts:102-106`, `types.ts:73-76`); `SandboxCapabilities.pty`
  is declared (`types.ts:68`, `:173`) and written by nine sandboxes (e.g. `docker-sandbox.ts:118`)
  but read nowhere.
- Preview routing, engine selection, coding-engine credentials/approvals, and budgeted unattended
  work are not modeled for coding sessions.

Users who want an agent to implement a feature in a real repository — then inspect, verify, and
PR it — have no supported path.

## Requirements

Scope of the first supported journey: an **existing Linux-compatible JavaScript/TypeScript web
repository** (monorepos and development services included). Other stacks may open, with
unsupported environment requirements disclosed explicitly.

1. **R1 — Repository-to-PR with each engine.** From a configured repository, user and agent agree
   an outcome with observable acceptance criteria recorded *before* implementation; the agent
   implements and verifies; the run ends with an inspectable diff, reported verification evidence,
   and a reviewable pull request — all within granted permissions.
2. **R2 — Two engines, fixed per session.** Normal Pi and OMP are selectable at session creation
   (default normal Pi for first-time users; most recent choice remembered; engine selection shown
   separately from model selection). Both expose prompt, steer, stop, resume, inspect changes, and
   approvals. Unsupported operations are surfaced as such — never a silent engine switch. Changing
   engine requires a new session.
3. **R3 — Normal Pi is a complete coding workflow.** Project instructions, file editing, commands,
   context management, resumable sessions — by reusing existing Rakazo capabilities; re-prompting
   the general assistant does not qualify.
4. **R4 — Project isolation and concurrency.** Concurrent coding tasks run in separate workspaces,
   branches, and execution state with no collisions in files, processes, service data, or ports;
   changes integrate explicitly rather than via last-writer-wins.
5. **R5 — Reproducible project setup.** A reviewable definition (dependencies, setup commands,
   development services, verification commands) that re-runs to reproduce the environment; the
   agent may propose changes to it. Replacing the environment reproduces setup and truthfully
   reports services that need restart.
6. **R6 — Workspace interaction.** File navigation, project search, text editing, diffs,
   reconnectable terminals (input + resize), and development previews that are private and
   authenticated by default; sharing is explicit and revocable, and distinct from production deploy.
7. **R7 — Takeover and checkpoint safety.** Manual edits and state-changing commands require
   explicit takeover: pause execution, settle active operations (including in-flight shell —
   closing the `executor.ts:2568` gap), and recheck workspace changes before the agent resumes;
   neither party's work is silently overwritten. Checkpoint restore honors a selected revision and
   protects subsequent manual edits (closing the `home.ts:86-93` gap).
8. **R8 — Continuity.** Server-owned work continues within configured limits when a client
   disconnects; clients reconnect to the existing session with pending approvals waiting; after a
   crash, actual outcomes are reconciled before retry. Explicit continuation into a new session
   (same workspace, optional handoff summary) stops the original run first and preserves original
   history; engine-internal runtime state is never translated across engines as if interchangeable.
9. **R9 — Budgets, failure, checkpoints.** Files and task history persist; idle compute suspends;
   unattended work is bounded by configurable budgets and deadlines. Failures preserve work and
   report the blocker, attempted verification, and the smallest action needed to continue; stopped
   execution never implies success. Checkpoints are not universal undo — external side effects
   (DB, deploys) need separate recovery semantics, reported truthfully.
10. **R10 — Secrets and authorization.** Project secrets are configured in Rakazo settings and
    injected scoped to the relevant environment or operation; values are excluded from prompts,
    transcripts, checkpoints, and handoff summaries. Missing credentials are blockers, never
    permission to bypass access controls. Engine selection grants no additional access; Rakazo owns
    credentials and authorization for both engines.
11. **R11 — Surfaces.** Web and Electron provide the full workspace; app and CLI attach to the same
    server-owned session; mobile exposes the applicable conversation, steering, approval, preview,
    and review workflows through native patterns. Self-hosted Linux server execution first.

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
  creation — no new storage engine in v1.
- **A2:** v1 acceptance centers on one complete repository workflow (discovery delivery step 3)
  before takeover/handoff/mobile completeness claims (step 4); the milestone route slices in that
  order.
- **A3:** PR creation uses the permissions already granted to the workspace credential; no new
  authorization model in v1.

## Open questions (for grill / plan)

- Q1: Does OMP ride the existing sandbox `execute` seam or need a process-boundary RPC adapter?
  How do approvals, sandbox placement, credential mapping, and recovery attach? (research §1)
- Q2: Replay/reconciliation semantics across reconnect and cross-engine handoff; handoff-summary
  contract. (research §2)
- Q3: Settle semantics for in-flight operations during takeover; restore-conflict policy;
  pre-resume workspace recheck mechanism. (research §3)
- Q4: Checkpoint contents and retention; external-effect journal/recovery design. (research §4)
- Q5: Concrete budget defaults; suspend/restart behavior of development processes. (research §5)
- Q6: ZCode workflow inventory → measurable acceptance cases with pass thresholds. (research §6)
- Q7: Setup-definition format, service lifecycle, and verified secret redaction across
  transcript/checkpoint/handoff surfaces. (research §7)

## Verification sketch (matrix rows to expand)

- **V1 Engine conformance (offline, deterministic):** each engine's session events, approvals,
  steering, stop, and recovery proven through its adapter.
- **V2 Repository-to-PR E2E per engine** on a fixture repo: pre-recorded acceptance criteria met,
  diff inspectable, PR openable; evidence captured.
- **V3 Concurrency:** two tasks on one bot — assert no cross-workspace file/process/port/service
  collisions.
- **V4 Takeover round trip:** manual edit during takeover survives agent resume; in-flight shell
  settled; neither side's work lost.
- **V5 Checkpoint restore:** selected revision restored; later manual edits preserved; external
  actions not implied rolled back.
- **V6 Disconnect/reconnect + crash:** pending approval waits; no duplicate run; reconciled outcome
  after crash.
- **V7 Previews:** private by default; grant + revoke enforced; sharing ≠ deploy.
- **V8 Secrets:** scoped injection; values absent from prompts, transcripts, checkpoints, and
  handoff summaries (greppable assertion).
