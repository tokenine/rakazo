# S1 QA Summary (run 2) — Feature 003 Agent Marketplace

- **Candidate under test:** `3178940e` (maker slice S1)
- **Fix candidate:** `771be989` (BUG-003-S1-01)
- **Checker:** omp-checker-003-s1-run2 (independent; did not author the candidate)
- **Host:** linux-arm64, Node v22.23.3, clean worktrees — no shared mutable maker tree
- **Verdict:** ❌ **NOT READY FOR MERGE** — runtime gates pass, but the static security lane found
  **3 high-severity defects** that block release. One runtime defect (BUG-003-S1-01) was found and
  fixed; the blocking findings are recorded below.

## Why this run exists

Recorded state said `state: qa_running` with `runs: []` — the earlier run was never registered. The
`003-s1-run1` evidence referenced `/Users/poom-work/...` (macOS) and could not be reproduced here, so
it was treated as foreign evidence and the candidate was re-verified from scratch on this host.

## Environment

Receipt: `.super-speckit/qa/003-s1-run2/environment-receipt.json`

| Item | Result |
|---|---|
| Node engine | system v22.22.1 failed `engines` (`^22.22.2`) → installed v22.23.3, all gates run on it |
| `pnpm install --frozen-lockfile` | pass |
| `prisma generate` | pass (client is gitignored; suite fails without it) |
| Worktree isolation | pass — clean checkout of the immutable SHA |
| Live database | **not provisioned** — DB-dependent assertions are not verified by this run |

## Gates

| Gate | At `3178940e` | At `771be989` |
|---|---|---|
| `agent-bundle.test.ts` | 25/25 | 28/28 |
| Full `apps/api` suite | 419/419 (31 files) | 426/426 (32 files) |
| `tsc --noEmit` (@rakazo/api) | clean | clean |
| Independent schema probes (23) | 23/23 | — |
| Token-tamper reproducer (4) | **2 FAIL — HTTP 500** | 4/4 — HTTP 401 |
| Static security review | **3 high / 4 medium / 2 low** | — |

## Blocking security findings

Full triage: `.super-speckit/qa/003-s1-run2/security-review.md`

| Severity | Finding |
|---|---|
| high | Bundle-controlled MCP `slug` collision reuses an existing credentialed server and grants it the bundle's declared tools |
| high | Portable stdio `command`/`args` reach `cross-spawn` — importing a bundle can propose a process the server will execute |
| high | Export's "fail-closed" secret scan is a no-op — `containsSecret(text, [])` always returns `false`, so the refusal branch is unreachable (**BUG-003-S1-02**) |
| medium ×4 | Unscanned MCP URL credentials; localhost SSRF via `endpoint`; unbounded preview-cache retention; unbounded array→DB write amplification |

The third high finding invalidates **V1**, whose "export REFUSED listing fields" clause depends on a
scan that provably never fires (runtime proof in BUG-003-S1-02).

## Runtime defect found and closed

**BUG-003-S1-01** — `agents.import` returned **HTTP 500** for a token whose HMAC segment was not 64
hex characters. `crypto.timingSafeEqual` throws `RangeError` on a length mismatch, and the segment
length was never validated. Reachable by any authenticated caller of `agents/import`.

Red-before / green-after was proven at the same seam:
- candidate `3178940e`: `2 failed | 26 passed`
- fix `771be989`: `28/28`
- independent retest (`ss/qa/003-s1-retest1`, clean worktree): original reproducer replayed
  unchanged → `500 → 401 UNAUTHORIZED`, 4/4.

The previous run's probe H1 ("wrong HMAC → 401") signed every token with a real 64-char digest, so
this branch was never executed. The 21/21 claim was accurate for what it probed; the gap was coverage,
not a false result.

## Matrix

| Row | Status | Basis |
|---|---|---|
| V1 round-trip | ❌ **not verified** | round-trip part passes, but its "export REFUSED on secret" clause depends on the no-op scan (BUG-003-S1-02) |
| V2 malicious bundles | ⚠️ verified after fix, with a gap | 23 independent probes + token reproducer pass; AGENT-BUNDLE-001/002 show the `allowAllTools=false` control is necessary but not sufficient |
| V6 machinery reuse | ✅ verified (unit) | mock-prisma assertions; **no live-DB assertion this run** |
| V8 legacy compatibility | ✅ verified | full suite, no regressions |
| V3 / V5 | ⬜ not-verified | S2 scope (UI + catalog seam) |
| V4 | ⚠️ performed, **failed** | security review run this run; 3 high findings, verdict blocking |
| V7 | ⬜ not-verified | S3 scope (mobile note) |

## Honest gaps

- No live database was provisioned, so V6's DB-assertion obligation is satisfied only at the
  unit/seam layer. Not converted to a pass.
- No OCR adapter is configured (`gates.ocr_review: ""`) while `require_ocr_triage_complete: true`.
  The configured merge gate therefore cannot be satisfied at all, independent of the code findings.
  An independent security-reviewer lane was run as a recorded substitute; it is static evidence and
  cannot satisfy any runtime row.
- AGENT-BUNDLE-009 (low) is `needs-review`: schema-backed, but its exact Prisma runtime failure still
  needs a runtime test. Not closed.
- Maker-authored tests were re-executed, not rewritten; the 23 independent probes are the checker's
  own, written from the matrix rather than from the maker's suite.
