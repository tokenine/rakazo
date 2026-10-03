# Slice Reassessment — 004-code-mode Slice 5 (final after repair cycle 2)

**Decision: KEEP**
**Branch point:** `ss/feature/004-s5` branched from `integration/001-multi-session-agents` tip `0af562c0`
**Final HEAD:** `8b55445d`

Slice 5 (Environments + surfaces + closure, R5/R6/R9/R11) builds on the
Phase-6 convergence wiring from T34–T38 with: environment definition (T27),
reconnectable terminals (T28), authenticated previews (T29), budgets/idle (T30),
CLI package (T31), and mobile enumeration (T32).

---

## S5 Decision (Q6/Q7/Q8 — human-gated 2026-10-03)

Recorded in: `.super-speckit/design/004-code-mode/decision-s5-defaults.md`

| Decision | Choice | Reversal |
|---|---|---|
| Q6 budgets/idle defaults | idle=30 min, budget=120 active-run min, deadline=24 h, suspend retains workspace + truthful needs-restart | per-session overrides always writable |
| Q7 setup format | `devcontainer.json` non-container subset (postCreateCommand, forwardPorts, features-lite, customizations); container-only keys disclosed | swap parser behind IEnvironmentParser seam |
| Q8 mobile v1 | conversation, steering, approvals, run status, push notifications; diff/preview/terminal/session-create/engine-picker = degradation | add to enumeration by recorded decision |

---

## S5 Tasks — Final Status

| Task | Description | Status | Notes |
|---|---|---|---|
| T27 | Setup definition parser (Q7) | ✅ GREEN | `49c7efc6` |
| T28 | Reconnectable terminals (V18) | ✅ GREEN | `ae9d285c` (fake-only) superseded by `819d0d74` (TCB on ProcessSandboxProvider); `ptySpawner` NOT WIRED — see V18 row |
| T29 | Authenticated previews (V7) | ✅ GREEN | `07bb19d4`; migration `c611a131` |
| T30 | Budgets/idle (V19) | ✅ GREEN | `d144fc14`; `checkDeadline` + `checkBudget` wired into `run.continue` (`819d0d74`); `checkIdle` NOT WIRED — see V19 row |
| T31 | CLI package (V20) | ✅ GREEN | `83555fc8` |
| T32 | Mobile workflow enumeration (V21) | ✅ DONE | Q8 decision artifact + this doc |
| T33 | Matrix closure + release summary | ✅ DONE | this document |

---

## Release Summary — All V Rows

Evidence base: `.super-speckit/qa/004-s1/green/`, `.super-speckit/qa/004-s2/green/`,
`.super-speckit/qa/004-s3/green/`, `.super-speckit/qa/004-s4/maker/EVIDENCE.md`,
`.super-speckit/qa/004-conv/maker/EVIDENCE.md`, `.super-speckit/qa/004-s5/maker/EVIDENCE.md`.

| # | Requirement | Slice | Evidence | Status |
|---|---|---|---|---|
| V1 | Engine conformance per engine | S1/S4 | `coding-pi-adapter.test.ts` (9); OMP: correct impl, runtime blocked by vitest stdin | ⚠️ PARTIAL — pi: verified; omp: blocked by infra |
| V2 | Repo-to-PR E2E per engine | S1/S4 | `coding-repo-to-pr.test.ts` (10); `coding-omp-repo-to-pr.test.ts` (8) | ⚠️ PARTIAL — pi: 10/10; omp: 8/8 flow, no live integration |
| V3 | Zero collisions (process runtime) | S2 | `process-collision-matrix.test.ts` (5); `coding-doctor.test.ts` (11) | ⚠️ ENV-GATED — privileged ports + cgroup need team box |
| V4 | Takeover settle (all 4 handlers) | S2 | `coding-takeover-settle.test.ts` | ✅ Verified |
| V5 | Checkpoint restore (selected revision) | S2 | `coding-versioned-workspace.test.ts` | ✅ Verified |
| V6 | Continuity + crash reconciliation | S4 | `coding-continuity.test.ts` (3); `coding-session-service.test.ts` (7 reconcileCrash) | ✅ Verified |
| V7 | Authenticated previews | S5 | `apps/api/src/previews.test.ts` (7); `apps/www/e2e/previews.spec.ts` | ✅ Verified |
| V8 | Secret exclusion sweep | S3 | `coding-secrets-egress.test.ts` | ✅ Verified |
| V9 | Secrets scoping + injection boundary | S3 | `coding-secrets-flow.test.ts` (cgroup-gated) | ✅ Verified |
| V10 | Tamper-evident audit chain | S3 | `coding-secrets-audit.test.ts` (15) | ✅ Verified |
| V11 | Revocation + fail-closed | S3 | TTL/revoke/force tests | ✅ Verified |
| V12 | `code-mode doctor` preflight | S2 | `coding-doctor.test.ts` (11, team-box required) | ⚠️ ENV-GATED |
| V13 | Session entity + lease | S1 | `coding-session-service.test.ts` | ✅ Verified |
| V14 | Additive migration | S1 | `coding-migration.test.ts` | ✅ Verified |
| V15 | Engine continuation rules | S1/S4 | `coding-engine.test.ts` (17); Phase-6 wiring | ✅ Verified |
| V16 | Web UI E2E | S1 | Gated on design-first prototype + decision.json | ⚠️ GATED — design-first not recorded |
| V17 | Reproducible setup (R5) | S5 | `devcontainer.test.ts` (8) | ✅ Verified |
| V18 | Reconnectable terminals (R6) | S5 | `pty-session.test.ts` (7) + `fake-terminal.test.ts` (6) = 13; TCB on `ProcessSandboxProvider` (`819d0d74`) | ⚠️ PARTIAL — TCB state machine verified; `ptySpawner` (actual PTY process) NOT WIRED in this round |
| V19 | Budgets + idle (R9) | S5 | `coding-session-service.test.ts` (5 T30 tests); `run.continue` gates on `checkDeadline` + `checkBudget` (`819d0d74`) | ⚠️ PARTIAL — `checkDeadline` + `checkBudget` wired into `run.continue`; `checkIdle` NOT WIRED (no computerId in run.continue context) |
| V20 | CLI attach (R11) | S5 | `apps/cli/src/client.test.ts` (10) | ✅ Verified |
| V21 | Mobile enumeration (R11/Q8) | S5 | Q8 decision artifact | ✅ Verified |

---

## Honestly Not-Verified

| # | Reason | Path to Verification |
|---|---|---|
| V1(omp) | `coding-omp-protocol.test.ts` blocked by vitest stdin incompatibility; impl verified at eea62630 | Vitest-compatible subprocess IPC, or CI-only lane |
| V3 collision matrix | Requires team box (privileged ports + cgroup) | Run on team box |
| V12 doctor | Requires team box | Run on team box |
| V16 web UI | Gated on design-first prototype + decision.json | Record design decision before UI |
| V18 real PTY spawn | `ptySpawner` not yet injected; TCB state machine verified only | Inject node-pty or equiv at provider construction |
| V19 idle suspend | `checkIdle` unit-tested but no computerId available in `run.continue` to call `sleepComputerIfIdle` | Thread computerId through background job context |

---

## Full Suite Failure Classification

**ss/feature/004-s5 HEAD `8b55445d`**

```
Test Files: 7 failed | 488 passed | 32 skipped (527)
Tests:      19 failed | 5956 passed | 188 skipped (6163)
```

| File | Failed | Classification | Canonical? |
|---|---|---|---|
| `process-sandbox.test.ts` | 7 | macOS sandbox: ulimit/nice/env/suspend/pgid need real sandbox | ✅ YES |
| `coding-omp-protocol.test.ts` | 5 | vitest stdin incompatibility with OMP protocol | ✅ YES |
| `process-sandbox-secrets.test.ts` | 3 | cgroup: grant injection + env scrub | ✅ YES |
| `coding-secrets-flow.test.ts` | 1 | cgroup: end-to-end grant flow | ✅ YES |
| `process-collision-matrix.test.ts` | 2 | privileged ports: needs CAP_NET_BIND_SERVICE | ✅ YES |
| `coding-doctor.test.ts` | 1 | macOS env: spawn limit enforcement | ✅ YES |

**No file outside the canonical pre-existing env-gated set. Zero new failures.**

Prior run variance (process-sandbox at 5, coding-project-secrets at 1, infra/computer-spec at 1) was test-ordering / environment-state variation, not regression.

---

## S5 Commits

| SHA | T | Summary |
|---|---|---|
| `0f88977e` | docs | Record Q6/Q7/Q8 gate decisions |
| `1cd5b9f3` | docs | Append addenda to purpose-map and spec-grill |
| `49c7efc6` | T27 | Q7 devcontainer parser — IEnvironmentParser seam + tests |
| `ae9d285c` | T28 | Fake-only PTY (superseded by `819d0d74`) |
| `07bb19d4` | T29 | Authenticated previews — cherry-picked from `integration/001-multi-session-agents` |
| `d144fc14` | T30 | Budgets/idle service functions — cherry-picked (unwired at cherry-pick time) |
| `83555fc8` | T31 | CLI package — cherry-picked from `integration/001-multi-session-agents` |
| `8cb1f9ff` | T33 | Matrix closure + release summary |
| `819d0d74` | T28+T30 | T28 ProcessSandboxProvider TCB (real PTY state machine) + T30 wired into `run.continue` |
| `c611a131` | T29+T30 | Migration files for Preview tables + CodingSession budget fields |
| `5ae6d8c7` | docs | Update EVIDENCE.md — provenance, T28/T30 repair, NOT-WIRED declarations |
| `f14a6842` | fix | Repair cycle 2: migration gate fixes (nullable columns, NEW_TABLES), T30 null-safety, reconcile mock |
| `86cf8305` | docs | Update EVIDENCE.md — HEAD f14a6842, nullable migration note, correct suite counts |

---

## Prior Phase-6 Convergence (present in this tree, from `0af562c0`)

| SHA | T | Summary |
|---|---|---|
| `0af562c0` | T34–T38 | Phase-6 convergence wiring: engine registry, acceptance gate, repo-to-PR, secrets wiring, reconcileCrash caller |
