# 004-code-mode Phase 6 Convergence Decisions

## D1: Queue reason — T34–T38 executes before S5

**Decision: T34–T38 (Phase 6 wiring) executes before S5 (surfaces).**

### Reasons

1. **Specs record**: `specs/004-code-mode/tasks.md` Phase 6 (2026-10-02) explicitly records "every coding-flow module has NO production entry point" — this is the zero-production-caller finding deferred by the S4 handoff §6.

2. **S5 human-gate**: S5 (handoff 004-S4-merged-S5-ready.md §7/§10) is gated on surfacing product questions Q6/Q7/Q8 to the human before hardcoding — it cannot start autonomously until those questions are answered.

3. **Ratified matrix rows**: T34–T38 complete already-ratified matrix rows (V1/V2/V6/V13/V15 + V8/V9 production feeding) without any new product surface questions. The wiring is purely mechanical: connect existing exports to existing call-sites.

   **Correction (fold)**: "purely mechanical" understates the round — the slice added a production RPC route (codingAcceptance), a run.completed lifecycle handler, and the composed secrets accessor; recorded for accuracy.

### Alternatives rejected

- **S5-first**: Would require human decision before any wiring could start, blocking productive work unnecessarily.
- **Halt-for-scope-re-gate**: Reversible — the lane branch `ss/feature/004-conv` is droppable, nothing is merged or pushed. If re-gating occurs later, the branch can be abandoned.

---

## D2: T36 "expose diff + verification views" interpretation

**Decision: T36 diff/verification views are exposed on the session/run data path for future surfaces to render, not a new UI surface built in this slice.**

Rationale:
- The task text reads "expose diff + verification views per R1/T5 (only-in-tests)" — R1/T5 refers to `runRepoToPr` which produces `diff` and `verificationCommands` records.
- These records are already stored on the session row (via `acceptance` JSON column) or as return values from `runRepoToPr`.
- Exposing them means ensuring the data is accessible on the session/run data path — no new UI components are built here.
- Web UI (T6 in the surfaces slice) will consume these exposed data paths to render the views.
- This is consistent with the design-first gating note: "design-first gating applies to UI; none is in scope."

---

## D3: super-speckit.yml script location finding

**Finding**: `super-speckit.yml` names `scripts/super_speckit.py` for the `status` and `validate` scripts, but the actual script is at `.super-speckit/scripts/super_speckit.py`.

Evidence:
- `cat .super-speckit/scripts/super_speckit.py` exists and is executable.
- `grep -r "super_speckit.py" .super-speckit/*.yml` → both `super-speckit.yml` (status/validate scripts) and `super-speckit-ci.yml` reference it.
- Stage receipts in this lane use state files + git evidence instead of the script output.

Action: No change to the YAML (would be scope creep). Noted for future maintenance.
