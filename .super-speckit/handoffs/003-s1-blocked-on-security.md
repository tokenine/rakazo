# Handoff — 003 S1 blocked on security findings

- **Feature:** 003-agent-marketplace · **Slice:** S1 · **State:** `qa_failed` (blocking findings open)
- **Candidate tested:** `3178940e` · **Closed bug fix:** `771be989` (BUG-003-S1-01)
- **Transfer:** `same-environment` · **Paused by:** automated QA (this orchestrator)

## State

Runtime verification is green and one high-severity runtime defect was found, fixed, and independently
retested. The static security lane then failed with three high-severity findings on the same import
surface, so S1 is **not** mergeable and S2 must not start on top of it.

| Item | Status |
|---|---|
| BUG-003-S1-01 (token HMAC → 500) | ✅ closed at `771be989`, independent retest 4/4 |
| BUG-003-S1-02 (export secret scan no-op) | ❌ open, high, blocks V1 |
| AGENT-BUNDLE-001 (MCP slug capability confusion) | ❌ open, high |
| AGENT-BUNDLE-002 (stdio host code execution) | ❌ open, high |
| AGENT-BUNDLE-004/005/006/007 (medium ×4) | ❌ open, fix triage |
| AGENT-BUNDLE-008 (low) | accepted-risk for S1 |
| AGENT-BUNDLE-009 (low) | needs-review — needs a runtime test |

## Evidence

- `.super-speckit/qa/003-s1-run2/qa-summary.md` — verdict, gate table, matrix
- `.super-speckit/qa/003-s1-run2/proof-pack.json` — machine-readable
- `.super-speckit/qa/003-s1-run2/security-review.md` — triaged static lane
- `.super-speckit/qa/003-s1-run2/environment-receipt.json` — readiness
- `.super-speckit/bugs/003-S1-token-hmac-crash.md`, `003-S1-export-secret-scan-noop.md`

## Decision made

Merge withheld despite `merge.autonomous_when_ready: true`. The setting authorizes merging a
*verified* candidate; three unfixed high-severity findings on the trust boundary mean the candidate is
not verified. Autonomy does not extend to shipping known-critical security defects.

## Next automatic action

Resume at `super-speckit.diagnose` → `fix` for each blocking finding, in this order:

1. **AGENT-BUNDLE-002** (stdio) — a bundle can propose a process the server spawns. Highest priority.
2. **AGENT-BUNDLE-003 / BUG-003-S1-02** (secret scan) — the promised control does not exist.
3. **AGENT-BUNDLE-001** (slug collision) — capability escalation onto an existing credentialed server.
4. Mediums 004–007, then re-run the security lane and this feature's gates.

## Resume conditions

- Each blocking finding gets its own bug artifact, an isolated `ss/bug/*` worktree, a red-green
  regression test, and an independent retest in a fresh QA worktree.
- S2 (`marketplace` UI + catalog seam) must not begin until 001–003 are closed, because the catalog
  installs the very bundles under discussion.
- `AGENT-BUNDLE-009` must not be closed without a runtime test.

## Unknowns / needs a human

- **`gates.ocr_review: ""` vs `merge.require_ocr_triage_complete: true`** is a config contradiction:
  the configured merge gate can never be satisfied. The owner should either configure an OCR adapter
  or set the requirement to false. This blocks merge on configuration grounds alone, independent of
  the code findings.
- AGENT-BUNDLE-002's fix likely changes the portable format (curated registry IDs instead of raw
  stdio command lines). That is a spec-level decision for the feature owner, not a QA decision.
