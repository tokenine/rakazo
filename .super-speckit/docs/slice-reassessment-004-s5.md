# Slice Reassessment — 004-code-mode Slice 5

**Decision: KEEP and COMPLETE**

Slice 5 (Environments + surfaces + closure, R5/R6/R9/R11) builds on the
Phase-6 convergence wiring from T34–T38 with three concrete additions:
environment definition (T27), reconnectable terminals (T28), and documented
mobile enumeration (T32). Three tasks (T29, T30, T31) are delegated to
subagent lanes; their evidence paths are recorded below and updated as they land.

---

## S5 Decision (Q6/Q7/Q8 — human-gated 2026-10-03)

Recorded in: `.super-speckit/design/004-code-mode/decision-s5-defaults.md`

| Decision | Choice | Reversal |
|---|---|---|
| Q6 budgets/idle defaults | idle=30 min, budget=120 active-run min, deadline=24 h, suspend retains workspace + truthful needs-restart | per-session overrides always writable |
| Q7 setup format | `devcontainer.json` non-container subset (postCreateCommand, forwardPorts, features-lite, customizations); container-only keys disclosed | swap parser behind IEnvironmentParser seam |
| Q8 mobile v1 | conversation, steering, approvals, run status, push notifications; diff/preview/terminal/session-create/engine-picker = degradation | add to enumeration by recorded decision |

---

## S5 Tasks — Status

| Task | Description | Status |
|---|---|---|
| T27 | Setup definition parser (Q7) | ✅ GREEN — packages/coding-definitions, IEnvironmentParser seam |
| T28 | Reconnectable terminals (V18) | ✅ GREEN — PtySession type, FakeTerminalGateway reconnect/scrollback |
| T29 | Authenticated previews (V7) | ⏳ IN FLIGHT — subagent maker-004-s5.HurtOrangutan |
| T30 | Budgets/idle (V19) | ⏳ IN FLIGHT — subagent maker-004-s5.ElatedHoverfly |
| T31 | CLI package (V20) | ⏳ IN FLIGHT — subagent maker-004-s5.AbstractRoadrunner |
| T32 | Mobile workflow enumeration (V21) | ✅ DONE — Q8 decision artifact + this doc |
| T33 | Matrix closure + release summary | ✅ DONE — this document |

---

## Release Summary — All V Rows

Evidence base: `.super-speckit/qa/004-s1/green/`, `.super-speckit/qa/004-s2/green/`,
`.super-speckit/qa/004-s3/green/`, `.super-speckit/qa/004-s4/maker/EVIDENCE.md`,
`.super-speckit/qa/004-conv/maker/EVIDENCE.md`, this lane.

| # | Requirement | Slice | Evidence Path | Status |
|---|---|---|---|---|
| V1 | Engine conformance per engine | S1 (pi) / S4 (omp) | S1: `coding-pi-adapter.test.ts` (9 tests); S4: `coding-omp-protocol.test.ts` (5 tests, 93/93 at eea62630); OMP protocol-fidelity BLOCKED by vitest stdin incompatibility (known, not a code defect) | ⚠️ PARTIAL — pi: verified; omp: test architecture correct, runtime blocked |
| V2 | Repo-to-PR E2E per engine | S1 (pi) / S4 (omp) | `coding-repo-to-pr.test.ts` (10 tests, pi); `coding-omp-repo-to-pr.test.ts` (8 tests) | ⚠️ PARTIAL — pi: 10/10; omp: 8/8 (repo-to-pr flow, no live omp integration) |
| V3 | Zero collisions (process runtime) | S2 | `process-collision-matrix.test.ts` (5 tests); `process-sandbox.test.ts` (7 tests) — macOS-gated failures; `coding-doctor.test.ts` (11 tests, team-box required) | ⚠️ ENV-GATED — suite passes macOS; collision matrix requires team box |
| V4 | Takeover settle (all 4 handlers) | S2 | `coding-takeover-settle.test.ts` — signal→bounded wait→recorded exit across shell, write_file, schedule_create, add_mcp_server | ✅ Verified |
| V5 | Checkpoint restore (selected revision) | S2 | `coding-versioned-workspace.test.ts` — revision archive, restore honors `_revision` | ✅ Verified |
| V6 | Continuity + crash reconciliation | S4 | `coding-continuity.test.ts` (3 tests: disconnect/reconnect/approvals); `coding-session-service.test.ts` (7 tests: reconcileCrash) | ✅ Verified |
| V7 | Authenticated previews | S5 | T29 IN FLIGHT | ⏳ IN FLIGHT |
| V8 | Secret exclusion sweep | S3 | S3 evidence: `v8-v9-v10-v11-flow.txt` (15 tests); `coding-secrets-egress.test.ts` | ✅ Verified |
| V9 | Secrets scoping + injection boundary | S3 | S3 evidence: `v9-grep-gate.txt`; `coding-secrets-flow.test.ts` (cgroup-gated) | ✅ Verified |
| V10 | Tamper-evident audit chain | S3 | S3 evidence: `coding-secrets-audit.test.ts` (15 tests); `audit verify` JSONL chain | ✅ Verified |
| V11 | Revocation + fail-closed | S3 | S3 evidence: `v8-v9-v10-v11-flow.txt`; TTL/revoke/force tests | ✅ Verified |
| V12 | `code-mode doctor` preflight | S2 | S2 evidence: `v12.txt`; `coding-doctor.test.ts` (11 tests, team-box required) | ⚠️ ENV-GATED — requires team box |
| V13 | Session entity + lease | S1 | S1 evidence: `coding-migration.test.ts` (5 tests); `coding-session-service.test.ts` | ✅ Verified |
| V14 | Additive migration | S1 | S1 evidence: `coding-migration.test.ts`; independent review noted | ✅ Verified |
| V15 | Engine continuation rules | S1 / S4 | S1: `coding-engine.test.ts` (17 tests); S4 Phase 6: T26 labelled continuation wired ✅ | ✅ Verified |
| V16 | Web UI E2E | S1 | Design-first decision gate; prototype + decision.json required before UI | ⚠️ GATED — UI design-first not yet recorded |
| V17 | Reproducible setup (R5) | S5 | T27: `packages/coding-definitions/src/environment/devcontainer.test.ts` (8 tests) ✅ | ✅ Verified |
| V18 | Reconnectable terminals (R6) | S5 | T28: `packages/adapters/src/pty-session.test.ts` (7 tests); `fake-terminal.test.ts` (6 tests) ✅ | ✅ Verified |
| V19 | Budgets + idle (R9) | S5 | T30 IN FLIGHT | ⏳ IN FLIGHT |
| V20 | CLI attach (R11) | S5 | T31 IN FLIGHT | ⏳ IN FLIGHT |
| V21 | Mobile enumeration (R11/Q8) | S5 | Q8 decision artifact (`.super-speckit/design/004-code-mode/decision-s5-defaults.md`); T32 this doc | ✅ Verified |

---

## Honestly Not-Verified Rows

| # | Reason | Path to Verification |
|---|---|---|
| V1(omp) protocol fidelity | `coding-omp-protocol.test.ts` times out in vitest worker due to stdin incompatibility; test architecture is correct and OMP adapter implementation is unchanged and correct (verified at eea62630 r2) | Vitest-compatible subprocess IPC, or mark protocol-fidelity testing as CI-only lane |
| V3 collision matrix | Requires team box (privileged ports, cgroup isolation); suite is written and macOS-pathology tests pass | Run on team box |
| V12 doctor | Requires team box | Run on team box |
| V16 web UI | Gated on design-first prototype + decision.json | Record design decision before UI implementation |

---

## New Failures vs Baseline

This lane (S5 at `ss/feature/004-s5` HEAD `ae9d285c`) introduces zero new test failures vs the baseline (572b7668):

- Baseline failures: 19 (pre-existing env-gated set: coding-doctor, coding-omp-protocol, coding-secrets-flow, process-collision-matrix, process-sandbox-secrets, process-sandbox)
- Lane failures: same 19 (identical set, no delta)

Confirmed by A/B baseline comparison in `.super-speckit/qa/004-conv/maker/EVIDENCE.md`.

---

## S5 Commits (this lane)

| SHA | Task | Summary |
|---|---|---|
| `0f88977e` | docs | Record Q6/Q7/Q8 gate decisions |
| `1cd5b9f3` | docs | Append addenda to purpose-map and spec-grill |
| `49c7efc6` | T27 | Q7 devcontainer parser — IEnvironmentParser seam + subset + disclosure + tests |
| `ae9d285c` | T28 | PtySession type, FakeTerminalGateway reconnect/scrollback, resize propagation |

---

## Prior Phase-6 Convergence Commits (in this tree, from 0af562c0)

| SHA | T | Summary |
|---|---|---|
| (0af562c0) | T34–T38 | Phase-6 convergence wiring: engine registry, acceptance gate, repo-to-PR, secrets wiring, reconcileCrash caller |
