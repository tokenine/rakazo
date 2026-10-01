# DRAFT — PENDING HUMAN GATE

Purpose Map — 004-code-mode (Rakazo Code). Rebuilt 2026-09-30 as a **draft proposal** from
`docs/code-mode-discovery.md` (operator decision (a): rebuild-planning-artifacts, relayed via Chief).
The human-only purpose gate has **not** run; `decision.json` records `confirmed_by: null`. This map
is not an implementation authorization.

## Intended outcome

Rakazo Code: a complete agent-assisted development workspace for technically comfortable users who
want to direct and review implementation. An agent operates an isolated server project environment;
the user can converse, inspect files and changes, view the running app, use a terminal, and take
manual control. The first supported journey is an existing Linux-compatible JavaScript/TypeScript web
repository (monorepos and development services included): configure a reproducible environment, agree
on a feature outcome, implement and verify it, inspect the preview and diff, and produce a reviewable
pull request within granted permissions.

## People affected

- Technically comfortable users who want the agent to perform most implementation work while they
  direct, steer, and review — served on web and Electron (full workspace), through app/CLI access to
  the same server-owned coding session, and on mobile via native patterns for the applicable
  conversation, steering, approval, preview, and review workflows.
- Users choosing a coding engine at session creation: normal Pi or OMP, fixed for that session
  (default normal Pi for first-time users; most recent choice remembered). Both engines must expose
  the essential workflow; adoption is not conditional on a comparative winner.
- Self-hosters: server execution on self-hosted Linux first, with Rakazo owning credentials and
  authorization for both engines.

## Success signal

- The repository-to-PR workflow runs with each engine: reproducible project setup, agreed outcome,
  implemented and verified feature, inspectable preview and diff, reviewable pull request — with
  observable acceptance criteria set before implementation and verification evidence reported.
- Both engines expose prompt, steer, stop, resume, inspect changes, and approvals; unsupported
  operations never cause a silent engine switch; the engine stays fixed per session.
- Concurrent coding tasks run in separate workspaces, branches, and execution state without
  collisions; takeover pauses execution and settles active operations so neither party's work is
  silently overwritten; checkpoint restore protects subsequent manual edits.
- Development previews are private and authenticated by default; sharing is explicit and revocable.
- Unattended work is bounded by configurable budgets and deadlines; failures preserve work and report
  the blocker, attempted verification, and the smallest action needed to continue.

## Non-goals

- ZCode is a functional benchmark only — not a visual design and not a commitment to
  feature-for-feature parity; Rakazo preserves its own interface and design system.
- No debugger UI, extension compatibility, or advanced refactoring initially; deferred until
  justified by actual tasks.
- No promise that arbitrary processes survive suspension; checkpoints are not universal undo —
  database changes, deployments, and other external actions need separate recovery semantics.
- Engine selection grants no additional access; no silent engine substitution.
- Unsupported environment requirements (native builds, other stacks) are disclosed explicitly, not
  silently attempted as supported.
- This draft record selects no runtime migration and authorizes no implementation; architecture
  decisions are recorded only after their tradeoffs are resolved.

## Human purpose gate

This map is a draft. A human confirms that this is the intended purpose, or corrects it. Technical
implementation choices are deliberately outside this gate. A confirmation is recorded in
`decision.json`; a correction returns the map to draft. Agents must never run `confirm-purpose` on
this feature — the gate is human-only (see `.super-speckit/handoffs/004-purpose-gate-to-cloud-agent.md`).
