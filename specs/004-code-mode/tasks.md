# Tasks — 004 Code mode

Spec: specs/004-code-mode/spec.md · Plan: specs/004-code-mode/plan.md ·
Matrix: specs/004-code-mode/verification-matrix.md · Route: milestone ·
Design: .super-speckit/design/004-code-mode/ (Q10 approved · Q9 FINAL r2 2026-10-01) ·
Grill: .super-speckit/grills/004-code-mode/spec-grill.md

Convention: red-green per slice — the slice's matrix rows are written as failing tests first,
then implementation turns them green. Deterministic offline where possible (fake sandbox
double); V3/V12 run directly on the team box under the process-level driver after doctor
passes (no host action required).

## Slice 1 — Repo-to-PR core, normal Pi, web (P1)

**Goal**: one configured repo, normal Pi, from agreed outcome to reviewable PR on web — the
first supported journey (R1/R3), on a session that owns its workspace.

- [ ] T1 (P1) CodingSession schema + migration: session bound to (workspaceId, engine) at
      creation; engine enum {normal-pi, omp}; workspace lease table (a second run cannot attach
      to a busy workspace) (packages/db/prisma/schema.prisma + migrations/**, additive) — V13/V14
- [ ] T2 (P1) Engine registry + dispatch: engine fixed at session creation; mid-session change
      impossible; unsupported ops surfaced, never silent switch
      (new packages/adapters engine module; verify exact dir) — V1(pi), V15
- [ ] T3 (P1) Normal-Pi coding adapter on existing run machinery (executor.ts:1102-1163,
      :4721-4739 reuse; no fork of run lifecycle) — V1(pi)
- [ ] T4 (P1) Acceptance-artifact gate: recorded outcome + verification commands required
      before first edit; refusal is explicit (gate at the existing approval/authorization
      point) — V2 precondition
- [ ] T5 (P1) Repo-to-PR flow: implement → inspectable diff → verification record (command,
      exit status, evidence artifact) → PR via existing workspace credential (R1, A3) — V2(pi)
- [ ] T6 (P2) Web UI: session create (engine picker, default normal-pi, last choice remembered
      per user), acceptance gate screen, diff + verification views. **UI design-first decision
      (prototype.html + decision.json) recorded BEFORE any UI implementation**
      (config design.required_when_paths **/*.tsx) — V16
- [ ] T7 (P1) Red-green tests: V1(pi), V2(pi), V13, V14, V15

**Checkpoint**: validate + status strict; S1 matrix rows green; commit candidate SHA.

## Slice 2 — Isolation + workspace safety: Q9 + G2 + R7 (P1)

**Goal**: concurrent tasks cannot collide; takeover is safe; checkpoints restore a chosen
revision without clobbering manual work.

- [ ] T8 (P1) `code-mode doctor` preflight: spawn limits enforceable (ulimit/nice), per-task
      tree creation + isolation, env scrub active; verdict + remediation text — V12
- [ ] T9 (P1) Per-task process-level runtime as a NEW sandbox provider behind the existing
      seam: dedicated workspace/data trees, spawn-time resource limits, env scrub; create at
      session start from setup definition; idle-suspend stops the task, retains the
      workspace; resume recreates (design brief D-Q9 lifecycle) — V3 prerequisite
- [ ] T10 (P1) Collision policy + fixture matrix: id-prefixed workspace/data dirs, dynamic
      port binding with retry, per-task process-group naming, namespaced service/db names;
      two tasks one bot, zero collisions across all enumerated classes — V3 (runs on the
      team box directly; no host-side prerequisite)
- [ ] T11 (P1) Versioned workspace store: append-only revision archive replaces `.previous`
      deletion (home.ts:57-82); dirty-set query; restore honors selected revision
      (`_revision`, home.ts:86-93); post-restore manual edits protected — V5
- [ ] T12 (P1) Takeover settle across ALL four handlers (shell executor.ts:2568, write_file
      :2424-2436, schedule_create :2761, add_mcp_server :2865) using the existing
      heldForTakeover guard pattern (:2334…): signal → bounded wait → recorded exit;
      pre-resume workspace recheck vs takeover baseline — V4
- [ ] T13 (P2) Checkpoint contents policy (node_modules excluded; dev-service data documented
      as not-checkpointed; external side effects reported, not implied rolled back) (Q5; default
      presented to user at slice review before hardcoding, same treatment as Q6/Q7) — V5

**Checkpoint**: validate + status strict; V4/V5 green; V3/V12 green on the team box under
the process-level driver (no host action involved).

## Slice 3 — Secrets subsystem: Q10 (P1)

**Goal**: project secrets reach the task context, scoped and audited, and appear nowhere
else (R10 as decided under Option B).

- [ ] T14 (P1) Project secrets store: per-project, encrypted at rest, reusing existing
      credential-storage primitives (docs/bot-secrets.md facility; verify schema first) — V9
- [ ] T15 (P1) Grants: task config declares required secret NAMES before start (same gate
      family as T4); injection resolves granted names only; no wildcards v1; TTL per
      (workspace, taskRun) — V9
- [ ] T16 (P1) Bootstrap injection at process spawn/bootstrap env only (env var or file in
      the task's own data dir); values never written to host/repo/workspace trees by the
      injection path — V9 grep gate
- [ ] T17 (P1) Egress deny-list filter: literal + base64/hex/URL transforms of granted values,
      applied to transcripts, command results, checkpoints, handoff summaries, QA evidence
      (replaces literal-only redaction executor.ts:2601 for coding sessions) — V8
- [ ] T18 (P1) Audit chain: append-only JSONL {seq, ts, actor, botId, workspaceId, taskRunId,
      secretName, secretRef, mechanism, ttl, grantRef} + sha256(prev_hash+entry) chain, head
      checkpointed to the run record; `audit verify` in QA evidence collection — V10
- [ ] T19 (P2) Revocation + rotation: TTL expiry, revoke (enforced next start) + `--force`
      stops the task now; settings rotation marks grants stale — V11
- [ ] T20 (P1) `docs/bot-secrets.md` carve-out annotation at top: superseded for 004-code-mode
      task runtimes only, pointer to decision.json; blanket refusal stands elsewhere — V9 doc row
- [ ] T21 (P2) Fail-closed guard + disclosure: if spawn-env injection cannot be guaranteed,
      secrets features disable with explicit user-facing disclosure (never silent);
      confidentiality-bounded-by-threat-model disclosure shown at gate — V11

**Checkpoint**: validate + status strict; V8/V9/V10/V11 green.

## Slice 4 — Continuity + OMP engine: R8/R2 (P2)

- [ ] T22 (P1) Disconnect/reconnect: server-owned run continues within configured limits;
      reconnect shows pending approvals; no duplicate run (executor.ts:4721-4739 reuse) — V6
- [ ] T23 (P1) Crash reconciliation: workspace dirty-set + last recorded action reported
      before any retry; stopped ≠ success — V6
- [ ] T24 (P1) Q1/G10 experiment: spawn `omp --mode rpc` (JSONL stdio) inside the task
      sandbox; record protocol findings + Q2/G11 builtin-approval answer in the grill addendum;
      **experiment precedes any adapter work** — V1(omp) gate
- [ ] T25 (P1) OMP adapter (post-experiment): prompt/steer/stop/resume/inspect/approvals per
      RPC findings; engine-internal state never translated across engines — V1(omp), V2(omp)
- [ ] T26 (P2) Labelled continuation: explicit new-session continuation MAY change engine;
      labelled + carries handoff summary; original run stopped first, history preserved — V15

**Checkpoint**: validate + status strict; V1/V2 complete across both engines; V6 green.

## Slice 5 — Environments + surfaces + closure: R5/R6/R9/R11 (P2/P3)

- [ ] T27 (P2) Setup definition (Q7): evaluate devcontainer.json vs custom; reproducible
      replace + truthful needs-restart report (service liveness vs definition) — V17
- [ ] T28 (P2) Reconnectable terminals: adapter-kit pty extension (session identity, resize/
      replay, attach — interfaces.ts:102-106, types.ts:73-76 today are fire-once) — V18
- [ ] T29 (P2) Authenticated previews: private by default; explicit revocable sharing;
      sharing ≠ deploy — V7
- [ ] T30 (P3) Budgets/idle (Q6): proposed defaults (idle threshold, budget units, deadlines)
      presented to user at slice review before hardcoding — V19
- [ ] T31 (P3) CLI package (new; apps/ has none today) — attach to server-owned session — V20
- [ ] T32 (P3) Mobile workflow enumeration (Q8): fixed list in this task before mobile work — V21
- [ ] T33 (P1) Matrix closure + release summary: every row verified/not-verified/
      not-applicable with evidence path; milestone reassessment (super-speckit.reassess) — all

## Dependencies

S1 → S2 → S3 (injection needs the spawn boundary) → S4 (OMP experiment may start early,
adapter lands after S1 seam) → S5. No host-side prerequisites anywhere in v1 (Q9-final
process driver). T6 and every UI task gated on the UI design-first decision. T24 precedes
T25. T20 is doc-only but ships with S3.

## Boundaries (standing)

No product code before the human approval gate on this plan + tasks bundle. maker ≠ checker
(super-speckit.yml); merge requires human; nothing pushed; codex cloud delegation disabled.
