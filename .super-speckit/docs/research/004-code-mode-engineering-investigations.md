# 004 Code Mode — engineering investigations (pre-implementation)

Status: **DRAFT — PENDING HUMAN GATE.** Rebuilt 2026-09-30 from `docs/code-mode-discovery.md` and the
out-of-repo verification record `004-s1-purpose-gate-r1` (attempt lineage), with every file:line
citation re-verified against the tree at `c2e6bb119fd38a25e11b68158ea69a065be8d899`
(`integration/001-multi-session-agents`). This is a planning input distilled from read-only code
inspection — it is **not** an implementation authorization, not a completed architecture, and it
resolves none of the product questions reserved for the human purpose gate.

Sources: `docs/code-mode-discovery.md` (accepted product direction, interview Q1–24) and read-only
code verification of the claims below. Findings are bounded code inspection, not live verification.

---

## 1. OMP integration shape vs. reuse of upstream Pi coding-session capabilities

**Investigation (discovery):** OMP integration shape and reuse of upstream Pi coding-session
capabilities versus existing Rakazo agent-core mechanisms. Both engines remain required; this is not
a competition to select one.

**Established today:**

- The normal-Pi path runs Pi's agent-core directly: `packages/adapters/src/pi-runtime.ts:3-9`
  imports `Agent`, `AgentMessage`, `AgentTool`, `AgentToolResult` from
  `@earendil-works/pi-agent-core`, with steering typed as `AgentSteeringMessage`
  (`packages/adapters/src/pi-runtime.ts:22`) and JSONL session recording via `PiJsonlSessionRecorder`
  (`packages/adapters/src/pi-runtime.ts:118-127`, started at `:237-261`).
- The engine-facing execution seam is the sandbox contract: `execute(computer, request, context):
  AsyncIterable<ProcessEvent>` at `packages/adapter-kit/src/interfaces.ts:102-106`, where
  `ProcessEvent` is `stdout | stderr | exit` only — no PTY stream
  (`packages/adapter-kit/src/types.ts:73-76`).
- Discovery records that OMP is a **fork of Pi**, not an extension attachable to the existing
  Pi agent-core loop; its SDK documentation requires Bun and describes host-owned tools and session
  events; RPC provides a separate process boundary (sources: `https://omp.sh/docs/sdk`,
  `https://omp.sh/docs/rpc`). Runtime-session formats must not be assumed interchangeable.

**Resolution / open:** engine selection at session creation, fixed per session, with normal Pi as the
complete Pi-based workflow (discovery). The integration *shape* — whether OMP rides the existing
sandbox `execute` seam or needs a process-boundary RPC adapter, and how approvals, sandbox placement,
credential mapping, and recovery attach — remains **open** and requires verification against OMP's
SDK/RPC documentation and a conformance harness (discovery delivery step 2).

## 2. Ownership of conversation state, runtime session state, and replay/reconciliation

**Investigation (discovery):** who owns conversation state, runtime session state, and
replay/reconciliation.

**Established today:**

- Conversation/run state is Rakazo-owned in the database: the takeover-resume path re-reads the DB
  only — `deps.prisma.run.findUnique({ where: { id: runId }, select: { status, checkpoint } })` at
  `packages/adapters/src/executor.ts:1551-1554` inside the `heldForTakeover` branch
  (`:1550-1562`); nothing filesystem-wise is rechecked through `:1600` (the only other reads are DB
  preference reads, e.g. `prisma.user.findUnique` nearby).
- Pi runtime session state is recorded to JSONL on the runtime side
  (`packages/adapters/src/pi-runtime.ts:118-127`, `:237-261`), separate from the DB run record.
- Discovery: continuation into a new session must use the existing workspace plus an optional handoff
  summary; preserve original history, stop the original run before transferring workspace control,
  and do not translate internal runtime state as if formats were interchangeable.

**Resolution / open:** Rakazo owns conversation/run state; engine-internal session state stays
engine-owned. **Open:** replay/reconciliation semantics across reconnect and engine handoff, and the
handoff-summary contract.

## 3. Conflict handling during checkpoint restore and takeover (stop/settle active operations)

**Investigation (discovery):** conflict handling during checkpoint restore; stopping or settling
active operations before transferring control; never silently overwriting either party's work.

**Established today (all paths verified at `c2e6bb11`):**

- Checkpoint: `checkpointComputerWorkspace` (`packages/adapters/src/computer-workspace.ts:91-104`)
  bumps a revision stamp for docker/cloudflare with the local home store (`return home.revise(homeKey)`
  at `:103`), else snapshots via a temp-dir copy (`:105` onward). Restore:
  `restoreComputerWorkspace` (`packages/adapters/src/computer-workspace.ts:50-66`) skips the home
  store for docker/cloudflare and otherwise calls
  `sandbox.importWorkspace(computer, home.exportHome(homeKey, context), context)` (`:65`).
- Restore ignores the requested revision: `home.restore(botId, _revision, dest, context)` just calls
  `this.checkout(botId, dest, context)` (`packages/adapters/src/home.ts:86-93`; `_revision` unused at
  `:88`). Revision "history" is one overwritten stamp per bot:
  `writeRevision` writes `rev-<ts>-<uuid>` into a single `home-revisions/<botId>.txt`
  (`packages/adapters/src/home.ts:170-176`). `copyDir` overwrites destinations without read-before-
  write (`packages/adapters/src/home.ts:315-338`, `writeFile(to, ...)` at `:335`) — so a restore can
  clobber subsequent manual edits.
- Takeover guards: screen/state-changing tools check `heldForTakeover` — `computer_observe`
  (`packages/adapters/src/executor.ts:2334`), `computer_act` (`:2345`), `open_path` (`:2604`),
  `launch_app` (`:2632`), page-browser tools (`:2682`) — but the **shell handler has no such guard**:
  `if (name === "shell")` at `packages/adapters/src/executor.ts:2568` applies only the
  desktop-protection guard (`:2570-2574`). User takeover/release are screen-control leases:
  `takeover` at `apps/api/src/router.ts:2249`, `release` at `apps/api/src/router.ts:2399` (release
  requires `controlHolder === "user"`, `:2403`); neither holds the filesystem.

**Resolution / open:** the gap the discovery brief describes is real in code: shell execution is not
paused during user takeover, and restore neither honors a selected revision nor protects later manual
edits. **Open:** settle/stop semantics for active operations (including in-flight shell commands),
restore-conflict policy, and the "recheck workspace changes before the agent resumes" mechanism.

## 4. Recovery for external side effects; checkpoint contents and retention

**Investigation (discovery):** recovery mechanisms for external side effects; checkpoint contents and
retention.

**Established today:**

- Workspace checkpoints cover project files only (the revision bump or temp-dir copy above);
  `docs/computer-runtime.md` keeps Team Computer folders inside one security boundary but does not
  provide project isolation (discovery, bounded audit).
- Checkpoints are not universal undo (discovery): database changes, deployments, and other external
  actions require separate recovery semantics. Stopped execution does not establish successful
  completion; after a crash, reconcile actual outcomes before retrying (discovery).

**Resolution / open:** no side-effect journal or external-action reconciliation exists in the
inspected surface; **open** — what belongs in a checkpoint, retention policy, and the
external-effect recovery design.

## 5. Concrete budget defaults and suspension/restart behavior

**Investigation (discovery):** concrete budget defaults; suspension/restart behavior.

**Established today:**

- The only observed execution bound in the inspected path is the per-command wall-clock timeout
  passed into every sandbox command (`timeoutMs: sandboxCommandTimeoutMs()`,
  `packages/adapters/src/executor.ts:5017`, inside the `runProcess` helper at `:5000-5020`).
- Discovery: persist files and task history; suspend idle compute; bound unattended work with
  configurable budgets and deadlines; do not promise survival of arbitrary processes across
  suspension; closing a client does not stop server-owned work within configured limits.

**Resolution / open:** defaults, deadline semantics, and restart behavior are **open**; nothing in
the inspected code establishes suspend/resume of development processes.

## 6. Initial ZCode workflow inventory and measurable acceptance cases

**Investigation (discovery):** initial ZCode workflow inventory and measurable acceptance cases.

**Established today:**

- ZCode supplies a functional benchmark only — not a visual design and not a commitment to
  feature-for-feature parity (discovery). The essential cross-engine workflow is fixed: prompt,
  steer, stop, resume, inspect changes, approvals; extra capabilities show only when supported, and
  unsupported operations never trigger a silent engine switch (discovery).
- Discovery proposes eight acceptance cases (repository-to-PR per engine; disconnect/reconnect
  without losing pending approvals; user-takeover round trip without overwriting manual edits;
  cross-engine continuation with handoff; concurrent tasks without collisions; file-checkpoint
  restore preserving later manual work; environment replacement with truthful service reporting;
  private-preview authorization/revocation, scoped credentials, bounded execution, truthful
  blocked/failure states). **None have been executed.**
- Delivery order proposed for planning: (1) map ZCode workflows to existing capabilities, pin
  upstream revisions; (2) prove each engine's session events/approvals/steering/stop/recovery via
  adapters with deterministic offline conformance cases; (3) one complete repository workflow with
  workspace isolation, files, terminal, private preview, changes, CLI reconnection; (4) takeover,
  handoff, checkpoint conflicts, suspension recovery, supported mobile controls.

**Resolution / open:** the case list is drafted but not measurable yet (no pass thresholds, no
instrumentation); workflow inventory mapping and conformance-case authoring remain **open**.

## 7. Reproducible setup format, service lifecycle, and project-scoped secret injection/redaction

**Investigation (discovery):** reproducible setup format, service lifecycle, project-scoped secret
injection and redaction.

**Established today:**

- Secrets load per space with plaintext env assembly:
  `deps.prisma.agentSecret.findMany({ where: { spaceId: run.spaceId }, select: { name, secret:
  { id, ciphertext } } })` at `packages/adapters/src/executor.ts:1257-1258`, decrypted via
  `decryptAgentEnvironment(agentSecretRows, deps.secretStore)` and pushed into `runSecrets`
  (`:1265-1266`). The plaintext env dict is handed to the sandbox `CommandRequest`
  (`env: Object.keys(env).length > 0 ? env : undefined` at
  `packages/adapters/src/executor.ts:5016`, helper `:5000-5020`). Command results are redacted:
  `return finish(redactAgentCommandResult(result, runSecrets))` at
  `packages/adapters/src/executor.ts:2601`.
- The shell tool yields stdout/stderr/exit only — no PTY (`interfaces.ts:102-106`,
  `types.ts:73-76`). `pty` is declared in the contracts (`CommandRequest.pty?` at
  `packages/adapter-kit/src/types.ts:68`; `SandboxCapabilities.pty` at
  `packages/adapter-kit/src/types.ts:173`) and written as literal capability flags by nine sandbox
  implementations (e.g. `packages/adapters/src/docker-sandbox.ts:118` `pty: true`,
  `packages/adapters/src/none-sandbox.ts:28` `pty: false`, plus `e2b-sandbox.ts:100`,
  `cloudflare-sandbox.ts:93`, `box-sandbox.ts:130`, `daytona-sandbox.ts:103`,
  `desktop-sandbox.ts:73`, `createos-sandbox.ts:215`, `fake-sandbox.ts:42`) but **read
  nowhere** — no reconnectable terminal with input/resize exists (matches discovery's gap note).
- Discovery: maintain a reviewable, reproducible project setup definition (dependencies, setup
  commands, dev services, verification commands; agent may propose changes); configure secrets
  through Rakazo settings, scope injection to the relevant environment/operation, and exclude secret
  values from prompts, transcripts, checkpoints, and handoff summaries; missing credentials are
  blockers, not permission to bypass access controls; preventing accidental tool-output leakage
  **requires engineering verification**.

**Resolution / open:** scoped loading and result redaction exist; transcript/checkpoint/handoff
exclusion, the setup-definition format, service lifecycle, and leakage verification are **open**.

---

## Citation verification note

Every `path:line` above was re-verified against the worktree at `c2e6bb119fd38a25e11b68158ea69a065be8d899`
on 2026-09-30. Corrections applied relative to the earlier verification record
(`004-s1-purpose-gate-r1`): env injection `executor.ts:5010` → `:5016` (helper `:5000-5020`);
`home.ts` restore `:87-95` → `:86-93`; shell desktop-protection guard `:2571` → `:2570-2574`;
resume block `:1550-1559` → `:1550-1562`; `copyDir` `:315-337` → `:315-338`; sandbox `pty` write
count "+7" → eight real providers plus `fake-sandbox.ts:42` (test double). `executor.ts` cites
resolve to `packages/adapters/src/executor.ts`; `router.ts` to `apps/api/src/router.ts`;
`interfaces.ts`/`types.ts` to `packages/adapter-kit/src/`.
