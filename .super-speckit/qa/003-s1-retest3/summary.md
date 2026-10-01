# Release summary — 003 Agent Marketplace, slice S1

- **Candidate:** `16c261cffdab84d31f553dcdf42f3ade27832eea`
- **Decision:** ❌ **not-ready-for-merge**
- **Authority:** `merge.autonomous_when_ready: true` — **deliberately not exercised**
- **Checker:** `omp-checker-003-s1-retest3` (independent)

## Why autonomous merge was withheld

The setting authorises merging a *verified* candidate. This candidate is not verified: a
high-severity capability escalation is runtime-confirmed against a real database. The previous
harness also recorded a configuration blocker, which is addressed below.

A second, independent reason: S1 was only ever verified with **mock** prisma doubles, and
AGENT-BUNDLE-009 is the proof that this is not a theoretical concern — a mock accepted
`CapabilityInstall` columns that do not exist on the model, so every mock-based probe passed while
a real import failed with HTTP 500. The first live-database run of this feature happened in this
retest, and it immediately found a further defect the mocks could not.

## Gate status

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | ✅ 442 passed / 446 (4 DB-gated run separately) |
| `@rakazo/contracts` | ✅ 59/59 |
| `tsc --noEmit` | ✅ clean |
| Real-Postgres import probes | ✅ 4/4 (red 4/4 at `3cbeeaca` — diagnostic failures) |
| Real-Postgres credential-inheritance probe | ❌ **FAIL** |
| Static security lane (V4 / OCR substitute) | ❌ **1 high, 3 medium, 1 low** |
| `require_no_open_confirmed_bugs` | ❌ BUG-003-S1-05 open and confirmed |

## Matrix coverage

| Row | Status |
|---|---|
| V1 round-trip | ✅ verified (live DB) |
| V2 malicious bundles | ❌ **failed** (BUG-003-S1-05) |
| V4 security review | ⚠️ performed, failed |
| V6 machinery reuse | ✅ verified (live DB) |
| V8 legacy compatibility | ✅ verified |
| V3 / V5 / V7 | ⬜ S2 / S3 scope |

## Defect loop to date

| Bug | Severity | Status |
|---|---|---|
| BUG-003-S1-01 token HMAC → 500 | high | ✅ closed `771be989`, retest 4/4 |
| BUG-003-S1-02 export secret scan no-op | high | ✅ closed `f399d4ee` |
| BUG-003-S1-03 stdio import RCE | high | ✅ closed `0fe3d561` |
| BUG-003-S1-04 preview-cache cross-actor clobber | low | ✅ closed `16c261cf` (red 1/48 → green 48/48) |
| **BUG-003-S1-05 credential inheritance** | **high** | ❌ **open**, fix dispatched to `ss/bug/003-s1-05` |

Plus `6783f681` (atomic refusals + valid audit columns) and the `6b5509b3` / `f0b3a181` / `3cbeeaca`
medium fixes, all re-verified at the tip.

## OCR triage

Following the precedent set by `001-s1-run1`, the substitute lane is the recorded resolution: an
independent read-only `security-reviewer` pass was run and **triaged**, and its findings are
recorded per-ID in `.super-speckit/qa/003-s1-retest3/security-review.md`. That triage is complete
as an artifact. It is a static lane and cannot satisfy any runtime matrix row, and it did in fact
fail — which is the honest outcome, not a gate satisfied by substitution.

**Residual config question for the owner:** `gates.ocr_review: ""` together with
`merge.require_ocr_triage_complete: true` means the configured gate has no adapter to satisfy it.
The 001 precedent treats triage-by-substitute-lane as satisfying it; 003 does the same here. No
config change was made — that is the project's own merge policy, not an orchestrator decision.

## Next action

Complete `ss/bug/003-s1-05` (reuse an existing MCP server only when it carries no credential), then
independently retest in a fresh worktree replaying the credential-inheritance reproducer unchanged.
Then the three open mediums, then a fresh security lane. **S2 must not start** — the catalog
installs the very bundles under discussion.
