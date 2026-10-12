# S1 PROVENANCE ADDENDUM — 004-code-mode (2026-10-01)

Requested by Chief after S1 disk verification @ `14b99cce` (substance VERIFIED GREEN; S2 GO withheld pending this addendum). Purpose: subagent-lane provenance for S1 under the SUBAGENT MANDATE (relayed 2026-10-01T05:17Z), plus record corrections.

## 1. Mandate timing — all execution post-mandate

- Mandate relayed: 2026-10-01T05:17Z (Chief → Tech Lead, user directive).
- First S1 implementation commit: `cb438aff` at **2026-10-01T05:29:47Z**. Last: `af6ecf89` at 06:16:58Z. **Every S1 execution commit postdates the mandate.**

**Inline-vs-subagent declaration: NO S1 work ran inline.** All implementation ran in three separate run_subagent invocations (maker / checker / fix), each at distinct SHAs, zero overlap. Main-thread commits (below) are orchestration-only — provenance, kit state transitions, and my own independent retest evidence — which is within the mandate's orchestration scope.

## 2. Lane provenance

**Honesty note (required by Chief, agreed):** the three run_subagent lanes existed at execution time; their run-time names were role-based kit defaults (the same house-default strings Chief found in the state json — correct that those prove nothing). The scheme names below are **canonical labels assigned post-hoc in this addendum** for provenance reference. No lane is invented; nothing non-existent is retroactively named.

| Lane (canonical label) | Type | Base → HEAD | Delivered |
|---|---|---|---|
| `rakazo-004-s1-maker-r1` | run_subagent, implementation | `ddd449db` → `43b1484e` (7 commits) | `cb438aff` T1 coding session + workspace lease schema, additive migration (V14) · `3c6cb999` T2 engine registry + dispatch, frozen binding (V15) · `645b31d2` T1 session service, exclusive lease (V13) · `adb91360` T3 normal-Pi adapter on existing run machinery (V1) · `8bdad795` T4 acceptance gate at applyTool · `7c48829b` T5 repo-to-PR (V2) · `43b1484e` T7 red-green evidence (V1/V2/V13/V14/V15) |
| `rakazo-004-s1-ck1` | run_subagent, review-only | reviewed @ `43b1484e` (zero commits) | READY-WITH-FIXES report: 1 HIGH, 4 MED, 5 LOW (adversarial, independent of maker) |
| `rakazo-004-s1-fix-r1` | run_subagent, fixes | `43b1484e` → `af6ecf89` (6 commits) | `b26d190b` HIGH-1 gate deny-by-default + fail-closed · `5de6781f` LOW-4 null-safe threadId · `45d13965` MED-2/3/4 + LOW-1/2 session-service hardening (takeover fence, transactional continuation) · `f06b12ba` MED-2 lease revalidation+renewal · `f831e3bd` LOW-3 additive latestRunId index + migration `20261002000000` · `af6ecf89` MED-1 honest biome + LOW-5 evidence scope |

## 3. Main-thread commits (orchestration-only; no product code)

- `ddd449db` (04:48:58Z) — approval provenance (`human_approval`: approver Poom5741, relayed_by Chief, 2026-10-01T04:43:50Z Chief clock, card_sha `407f7822`, verified_tree `1952097c`) + state → maker_running. Pre-mandate; provenance only.
- `f4b1376c` (05:32:39Z) — candidate lock @ `43b1484e` + state → candidate_ready.
- `14b99cce` (06:19:50Z) — my independent retest evidence (143/145 + executor regression 60; biome scoped 0/0; tsc clean ×3) + final state candidate_ready @ `af6ecf89`.

## 4. Record corrections

- **Commit count:** the slice report said "14 commits this phase". Actual per `git rev-list --count ddd449db..14b99cce` = **15** (7 maker + `f4b1376c` + 6 fix + `14b99cce`); 16 including the range-start approval commit `ddd449db` itself. Corrected.
- No other figures change: diffstat 31 files +4895/−5 and approval provenance were verified byte-exact by Chief.

## 5. Ratified v1 constants (Chief decision under standing delegation — technical constants, resettable without structural change)

- coding_session lease TTL default = **10 minutes** — CONFIRMED as v1 default.
- default credential name = **`github_token`** — CONFIRMED as v1 default.

Both to be restated in S2 slice evidence and wherever the code declares them.

## 6. Boundaries (unchanged)

No push (deploy key stays unattached), no codex cloud exec, Dev's clones untouched, `merge_requires_human: true`, T6 UI design-first gate intact.
