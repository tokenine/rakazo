# Code mode discovery

Status: product decisions through interview question 24 accepted. Consolidated for shared-understanding review; engineering investigations remain open. This is not an implementation authorization or a completed architecture.

## Product brief

Rakazo Code is a complete agent-assisted development workspace for technically comfortable users who want to direct and review implementation. An agent operates an isolated server project environment; the user can converse, inspect files and changes, view the running app, use a terminal, and take manual control. Normal Pi and OMP are supported engine choices fixed at session creation. ZCode supplies a functional benchmark, not a visual design or a commitment to feature-for-feature parity.

The first supported journey is an existing Linux-compatible JavaScript/TypeScript web repository, including monorepos and development services: configure a reproducible environment, agree on a feature outcome, implement and verify it, inspect the preview and diff, and produce a reviewable PR within granted permissions. Native builds and other stacks may be attempted, but unsupported environment requirements must be disclosed.

Web and Electron provide the full workspace. App and CLI access refer to the same server-owned coding session. Mobile preserves applicable conversation, steering, approval, preview, and review workflows through native patterns; the exact mobile workspace controls remain to be designed.

## Accepted direction

- Serve technically comfortable users who want the agent to perform most implementation work.
- First acceptance workflow: improve an existing repository, verify a substantial feature, and produce a reviewable pull request.
- Use ZCode as a functional benchmark; preserve Rakazo's own interface and design system.
- Provide direct agent communication, self-hosting, provider neutrality, and session continuity. Support both normal Pi and OMP as user-selectable coding engines; adoption is not conditional on a comparative winner.
- Choose the coding engine when creating a session and keep it fixed for that session. Changing engines requires a new session.
- Offer an explicit continuation into a new session using the existing workspace and an optional handoff summary. Preserve the original history and stop its active execution before transferring workspace control; do not translate internal runtime state as if formats were interchangeable.
- Rakazo owns credentials and authorization for both engines. Adapters enforce those decisions; engine selection grants no additional access.
- Concurrent coding tasks use separate workspaces, branches, and execution state. Changes are integrated explicitly rather than allowing concurrent agents to overwrite shared files.
- Restore project files to a selected checkpoint while protecting subsequent manual edits. Database changes, deployments, and other external actions require separate recovery semantics; checkpoints are not universal undo.
- Preserve bot continuity while isolating project environments. Keep bot memory and permitted connections separate from project dependencies and services.
- Deliver server execution on self-hosted Linux first, accessible through web and Electron. Preserve existing applicable surfaces and native mobile patterns.
- Permit routine edits, tests, and project-local setup inside isolated development environments. Require explicit or scoped standing authorization for production changes, destructive actions outside the workspace, publishing, and merging.
- Establish observable acceptance criteria before implementation. Report verification evidence, limitations, and changes; independently review substantial work.
- Initially support file navigation, project search, text editing, diffs, terminals, and previews. Defer debugger UI, extension compatibility, and advanced refactoring until justified by actual tasks.
- Persist files and task history. Suspend idle compute; bound unattended work with configurable budgets and deadlines. Do not promise survival of arbitrary processes across suspension.
- Allow inspection during agent execution. Manual edits and state-changing commands require explicit takeover: pause execution and settle active operations before transferring control. Recheck workspace changes before the agent resumes; never silently overwrite either party's work.
- Closing a client does not stop server-owned work within configured limits. Clients reconnect to the existing session; approval requests wait for an answer. Following a crash, reconcile actual outcomes before retrying actions.
- Development previews are private and authenticated by default. Sharing is explicit and revocable; sharing a preview is separate from deploying to production.
- Both engines expose the essential workflow: prompt, steer, stop, resume, inspect changes, and approvals. Additional capabilities are shown only when supported. Unsupported operations never cause a silent engine switch.
- Default to normal Pi for first-time users, then remember the most recently selected engine for new sessions. Show engine selection at session creation separately from model selection.
- Normal Pi must provide a complete Pi-based coding workflow: project instructions, file editing, commands, context management, and resumable sessions. Reuse existing Rakazo capabilities; changing the general assistant's prompt alone does not fulfill this requirement.
- Initially guarantee Linux-compatible JavaScript/TypeScript web projects, including monorepos and development services. Other repositories may be opened, with unsupported environment requirements identified explicitly.
- Maintain a reviewable, reproducible project setup definition covering dependencies, setup commands, development services, and verification commands. The agent may propose changes to that definition.
- Configure project secrets through Rakazo settings and scope injection to the relevant environment or operation. Secret values must be excluded from prompts, transcripts, checkpoints, and handoff summaries. Missing credentials are blockers, not permission to bypass access controls; preventing accidental tool-output leakage requires engineering verification.
- On failure, preserve work and report the blocker, attempted verification, and smallest action needed to continue. Pause for missing access or product decisions, and bound repeated failed attempts. Stopped execution does not establish successful completion.

## Current foundations and gaps

Read-only audit found direct Pi agent-core execution and steering in `packages/adapters/src/pi-runtime.ts`, computer contracts in `packages/adapter-kit/src/interfaces.ts`, and workspace persistence in `packages/adapters/src/computer-workspace.ts`.

Team Computer folders share a security boundary according to `docs/computer-runtime.md`; they do not establish project isolation. `packages/adapters/src/home.ts` exposes latest-only persistence, not versioned rollback. Shell command execution does not establish a reconnectable terminal with input and resize support. Browser/screen access does not establish application preview routing. Run recovery does not establish arbitrary development-process recovery. These findings are bounded code inspection, not live verification.

## OMP investigation

Integrate OMP as a selectable coding engine alongside normal Pi. OMP is a fork of Pi, not an extension to attach to the existing Pi agent-core loop. Its SDK documentation requires Bun and describes host-owned tools and session events; RPC provides a separate process boundary. Approval integration, sandbox placement, credential mapping, and recovery still require verification. Do not assume runtime-session formats are interchangeable.

Sources: https://omp.sh/docs/sdk and https://omp.sh/docs/rpc.

## Engineering investigations before implementation

- OMP integration shape and reuse of upstream Pi coding-session capabilities versus existing Rakazo agent-core mechanisms. Both engines remain required; this is not a competition to select one.
- Ownership of conversation state, runtime session state, and replay/reconciliation.
- Conflict handling during checkpoint restore and stopping or settling active operations for takeover.
- Recovery mechanisms for external side effects; checkpoint contents and retention.
- Concrete budget defaults and suspension/restart behavior.
- Initial ZCode workflow inventory and measurable acceptance cases.
- Reproducible setup format, service lifecycle, and project-scoped secret injection/redaction.

## Proposed acceptance evidence

These cases operationalize the accepted behavior; they have not been executed:

- Run the supported repository-to-PR workflow with each engine and inspect the resulting diff, checks, and application behavior.
- Disconnect and reconnect app/CLI clients without creating another run or losing pending approvals.
- Transfer control to a user and back without silently overwriting manual edits.
- Start a new session with another engine through an explicit handoff; preserve original history and prevent simultaneous ownership of the reused workspace.
- Run concurrent tasks without collisions in files, processes, service data, or ports.
- Restore a file checkpoint without discarding later manual work or implying rollback of external actions.
- Replace an environment and reproduce project setup while truthfully reporting services that need restart.
- Verify private preview authorization and revocation, scoped credentials, bounded execution, and truthful blocked/failure states.

## Delivery order proposed for planning

1. Map required ZCode workflows to existing Rakazo capabilities and missing contracts; pin upstream revisions for reproducibility.
2. Prove each engine's session events, approvals, steering, stop, and recovery through adapters and deterministic offline conformance cases.
3. Deliver one complete repository workflow with workspace isolation, files, terminal, private preview, changes, and CLI reconnection.
4. Complete takeover, handoff, checkpoint conflicts, suspension recovery, and supported mobile controls before claiming reliable daily use.

This sequence is a planning proposal, not authorization to modify runtime behavior.

Record architecture decisions only after their tradeoffs are resolved. No runtime migration is selected by this document.
