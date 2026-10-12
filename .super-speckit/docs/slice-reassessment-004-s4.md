# 004-code-mode — Slice 4 reassessment (Continuity + OMP engine)

## What was verified (independently, orchestrator + checker + retest)

- **Scope:** Slice 4 T22–T26 against `plan.md` S4, matrix rows V1(omp), V2(omp), V6, V9 (the
  row whose regression was missed by the S3-vintage evidence and re-surfaced here),
  V15, and `.super-speckit/design/004-code-mode/decision.json` Q10 + the addendum
  settling Q1/G10 (RPC transport confirmed) and Q2/G11 (host-answered `extension_ui`
  select approvals).
- **Maker lane:** `MakerS4` → `MakerS4r2` → orchestrator fold (R2-2 deadlock in the
  OMP RPC dispatcher + missing `abort` round-trip in the mock child + `message` field
  vs the live protocol + the r1 miscopied OMP-shape into `CodingPiAdapterDeps.inspectChanges`)
  → `BUG-004-S4-V9` fix (strict-subset regex restoration). Three review rounds on the
  integration line, two of them addressable by the maker, one requiring an
  orchestrator fold (maker repair cap exhausted), one requiring an orchestrator
  independent verification that caught a regression the checker misclassified.
- **Candidate SHA:** `c602232a`.
- **Checker verdict (independent):** READY. Gate 0 errors; 93/93 matrix suites (V6,
  V1(omp), V2(omp), V15); biome clean on touched files.
- **Retest verdict:** BUG-004-S4-V9 closed. Gate 0; V9 9/9; matrix 93/93; 5
  pre-existing failures (teaching-session, computer-update, computer-idle 3×30s)
  unchanged — none in 004 S4 surface.

## Evidence anchors

- `.super-speckit/qa/004-s4/experiment/omp-rpc-probe/` — T24 live OMP RPC probe
  (ready handshake, terminal approval/ignore-deadlock, yolo runs bare, tool-result
  integrity finding).
- `.super-speckit/grills/004-code-mode/spec-grill.md` — addendum settling G10/Q1,
  G11/Q2 with live evidence; integrity finding for V2(omp) tool-result sourcing.
- `.super-speckit/qa/004-s4/maker/EVIDENCE.md` — r1 and r2 evidence including
  orchestrator-fold attribution; honesty on retained shortcomings (runtime
  consumption of `buildEngineRegistry` remains an S1 wiring gap, flagged for
  review, not silently ignored).
- `.super-speckit/qa/004-s4-checker/{environment-receipt.json, findings.json}` —
  checker per-row verdict + bytecode-explicit evidence paths.
- `.super-speckit/qa/004-s4-retest/retest-environment-receipt.json` — retest
  numeric verification of the V9 fix; pre-existing failures unchanged.

## Honest retained shortcomings (declared, not silently ignored)

- **Runtime consumption of `buildEngineRegistry`:** the composed engine registry
  has no production caller (the same was true for the pi adapter in S1). The
  executor consumes coding runs by `trigger === CODING_SESSION_TRIGGER`, not
  through the registry. Adopting the registry in the executor path belongs to a
  later integration slice; flagged here so slice review sees it.
- **5 pre-existing unrelated failures** (`teaching-session`,
  `computer-update`, `computer-idle ×3` 30s Linux timeouts): out of 004-code-mode
  scope. Neither introduced nor fixed by this slice.
- **`process-sandbox*` / `coding-doctor` 12 environment-gated failures:** already
  dispositioned in the S3 reassessment ("passes on the team box"). Out of S4 scope.

## Decision

**keep** — continue the milestone route. Next: S5 (Environments + surfaces + closure:
R5/R6/R9/R11; T27–T33). The S4 matrix is fully verified (V6/V1(omp)/V2(omp)/V9/V15)
and the S4 candidate is mergeable.