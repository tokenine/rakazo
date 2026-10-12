# Plan — 004 Code mode (Rakazo Code)

Spec: `specs/004-code-mode/spec.md` · Base: c2e6bb11 (`integration/001-multi-session-agents`) ·
Branch `tl/004-purpose-gate-r1` · Route: milestone ·
Grill: `.super-speckit/grills/004-code-mode/spec-grill.md` ·
Design: `.super-speckit/design/004-code-mode/{design-brief.md,decision.json}` (Q10 approved · Q9 FINAL r2)

## Key findings (research + grill, 2026-10-01)

- Run/context machinery already exists and is reusable (`executor.ts:1102-1163`, `:4721-4739`);
  what is absent is the *coding-session concept*: no engine field, no engine dispatch, no
  workspace-lease ownership (two runs must never own one workspace).
- A sandbox-provider seam already ships (`docker-sandbox.ts` among 8 real providers + fake
  double) — Q9-final's process runtime lands as a NEW provider behind that seam; the new
  work is task-scoped lifecycle + collision policy + doctor preflight, not a new container
  stack. Docker remains a documented future driver (host-side preconditions in D-Q9), not v1.
- Q9 evidence: team box seccomp blocks `CLONE_NEWUSER` (nothing container-ish installable from
  inside) — which drove the FINAL pick: option 3 process-level isolation (no host action,
  no docker dependency). The docker paths are recorded as future upgrades, not v1 work.
- Q10 evidence: redaction today is literal-only (`executor.ts:2601`) and checkpoints are raw
  snapshots (`home.ts:57-82`) — the egress filter + V8 sweep are net-new, and the versioned
  workspace store (G2) is prerequisite to safe checkpoint/restore (R7).
- Takeover gap is four handlers wide (G1): shell `:2568`, write_file `:2424-2436`,
  schedule_create `:2761`, add_mcp_server `:2865` vs guarded desktop checks `:2334`…`:2682`.

## Approach

- **CodingSession entity + workspace lease (Q3)**: new durable session bound to
  (workspace, engine) at creation; engine enum {normal-pi, omp}; a per-workspace lease table so
  a second run cannot attach to a busy workspace (never last-writer-wins). Normal Pi rides the
  existing run machinery; OMP gets an adapter behind the same interface.
- **Acceptance-artifact gate (R1)**: before the agent's first edit, the session requires a
  recorded acceptance record (outcome + verification commands); gate lives at the same
  authorization point as existing approvals.
- **Isolation runtime (Q9-final)**: `code-mode doctor` preflight; one process-level task
  context per run from the setup definition — dedicated workspace/data trees, spawn-time
  resource limits (ulimit/nice), env scrub — as a new sandbox provider; collision policy per
  design brief (dynamic port binding with retry, id-prefixed dirs, per-task process-group
  naming); idle-suspend stops the task, retains the workspace (R9).
- **Versioned workspace store (G2/R7)**: replace latest-only commit/`.previous` deletion
  (`home.ts:57-82`) with an append-only revision archive + dirty-set query; restore takes a
  selected revision (`:86-93` `_revision` honored) and protects post-restore manual edits.
- **Takeover settle (R7/G1/Q4)**: guard all four unguarded handlers with the existing
  `heldForTakeover` check; settle = signal → bounded wait → recorded exit; pre-resume recheck
  compares workspace dirty-set against the takeover baseline.
- **Secrets subsystem (Q10)**: per-project encrypted store (reusing existing credential
  primitives), declared-name grants resolved before start, injection at process spawn/bootstrap
  env only, single deny-list egress filter (literal + base64/hex/URL transforms) across
  transcripts/checkpoints/handoffs/QA, hash-chained JSONL audit with `audit verify`, TTL +
  revoke (enforced at next task start; `--force` stops the task immediately). Fail-closed: if
  spawn-env injection cannot be guaranteed, secrets are disabled with explicit disclosure.
  Confidentiality under process isolation is bounded by the trusted-code threat model —
  disclosed at the gate.
- **Continuity (R8)**: server-owned runs survive disconnect; reconnect sees pending approvals;
  crash reconciliation = workspace dirty-set + last recorded action, surfaced before retry;
  explicit continuation into a new session may change engine only as a labelled handoff (R2).
- **Surfaces (R11/A4)**: web first (design-first required for `**/*.tsx` slices); CLI and full
  mobile completeness sequenced after the web repo-to-PR slice is verified.

## Slices

1. **S1 — Repo-to-PR core, normal Pi, web** (grill Builder slice 1): CodingSession + lease
   (V-rows 13/14 groundwork), engine registry + normal-pi adapter on existing machinery,
   acceptance gate, implement → diff → verification record → PR via existing workspace
   credential (V2 pi path; V1 pi subset). Web UI tasks gated on the UI design-first decision.
2. **S2 — Isolation + workspace safety (Q9 + G2 + R7)**: doctor preflight (V12); per-task
   process-level runtime (new sandbox provider) + collision fixture matrix (V3); versioned
   workspace store (G2); takeover settle across all four handlers + pre-resume recheck (V4);
   selected-revision restore + manual-edit protection (V5). No host-side prerequisites —
   team-box evidence runs directly under the process driver.
3. **S3 — Secrets subsystem (Q10)**: store + grants + bootstrap injection + egress filter
   (V8/V9) + audit chain (V10) + revocation/rotation (V11) + `docs/bot-secrets.md` carve-out
   annotation (doc edit, not rewrite).
4. **S4 — Continuity + OMP engine (R8/R2)**: disconnect/reconnect + crash reconciliation
   (V6); Q1/G10 OMP RPC experiment (spawn `omp --mode rpc` inside the sandbox), Q2/G11 builtin
   approvals resolution, then OMP adapter + labelled cross-engine continuation (V1 omp path,
   V2 omp E2E) — gated on the experiment's outcome.
5. **S5 — Environments + surfaces + closure (R5/R6/R9/R11)**: setup definition format (Q7:
   evaluate devcontainer.json vs custom) + reproducible replace with restart oracle (R5);
   reconnectable terminals via adapter-kit pty extension (G7) + authenticated previews (V7);
   budget/deadline defaults (Q6); CLI package (new, post-web); mobile workflow enumeration
   (Q8); matrix closure + release summary.

## Risks / constitution checks

- **Threat model is the boundary (Q9-final)**: process isolation guards accidents/resource
  conflicts on trusted user code, NOT malice — no container-grade containment is claimed
  anywhere; secret confidentiality is bounded the same way (spawn-env readable by same-UID
  processes). Disclosed at the approval gate and in D-Q9/D-Q10; the docker upgrade paths stay
  documented with their host-side preconditions if containment is ever demanded.
- **Fail-closed secrets**: if spawn-env injection cannot be guaranteed on a runtime, secrets
  features disable themselves with explicit disclosure — never silent degradation.
- **Protected paths**: `migrations/**` (CodingSession + lease tables) → independent review
  before merge; additive-only migrations.
- **OMP unknowns (Q1/Q2)**: unapproved builtin bash/edit would be a silent R10 breach — the
  experiment precedes any OMP adapter merge, and V1-omp is gated on it.
- **maker ≠ checker** per `super-speckit.yml`; merge requires human; no push without approval;
  codex cloud delegation stays disabled.
- Budget defaults (Q6) and setup format (Q7) are product decisions — proposed in S5 tasks with
  reversible defaults, flagged to the user at slice review.
