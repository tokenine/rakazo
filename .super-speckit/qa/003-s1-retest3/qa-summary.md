# S1 Retest 3 — Feature 003 Agent Marketplace

- **Candidate under test:** `16c261cf` (tip of the S1 fix stack)
- **Checker:** `omp-checker-003-s1-retest3` — independent; did not author any commit under test
- **Worktree:** `ss/qa/003-s1-retest3`, detached checkout of the immutable SHA
- **Host:** linux-arm64, Node v22.23.3 (`/opt/node-22.23.3`; system v22.22.1 fails `engines`)
- **Verdict:** ❌ **NOT READY FOR MERGE** — all deterministic gates pass and the previously
  blocking runtime defects are closed with live-database proof, but one **high**-severity
  capability-escalation defect survives and is runtime-confirmed: **BUG-003-S1-05**.

## Why this run exists

The state index recorded `qa_failed` at candidate `771be989` with three open high-severity findings,
while git carried a seven-commit fix stack on top of it and an eighth fix sitting uncommitted in
`ss/bug/003-s1-04`. The index was stale, so this run:

1. recovered the uncommitted `AGENT-BUNDLE-008` fix (test harness corrected, red/green measured,
   committed as `16c261cf`);
2. re-ran every gate against the real tip;
3. added the **first live-database evidence this feature has ever had** (see below);
4. re-ran the static security lane, which found a surviving high that the previous lane's
   endpoint-mismatch framing had missed.

## Environment

Receipt: `.super-speckit/qa/003-s1-retest3/environment-receipt.json`

| Item | Result |
|---|---|
| Node engine | system v22.22.1 fails `engines ^22.22.2`; v22.23.3 used for all gates |
| `pnpm install --frozen-lockfile` | pass |
| `prisma generate` | pass (client is gitignored) |
| Worktree isolation | pass — detached checkout of `16c261cf`, only throwaway probe files untracked |
| **Live database** | **provisioned** — fresh `postgres:17-alpine`, `prisma migrate deploy` applied |

## Gates at `16c261cf`

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | 442 passed / 446 (4 skipped — the DB-gated probe, run separately) |
| `@rakazo/contracts` | 59 passed |
| `tsc --noEmit` (@rakazo/api) | clean |
| **Real-Postgres import probes (new)** | **4/4 pass** — first live-DB evidence for this feature |
| Real-Postgres credential-inheritance probe (new) | **1/1 FAIL — BUG-003-S1-05** |
| Static security lane (re-run) | **1 high, 3 medium, 1 low** — blocks |

## Live-database probes (`qa-retest3-realdb.test.ts`)

The previous run recorded "no live database was provisioned" as an honest gap, and
AGENT-BUNDLE-009 is exactly the finding that gap could have caught: a mock prisma double accepts
`CapabilityInstall` columns that do not exist on the model, so every mock-based probe passed while
a real import failed at the last step with HTTP 500.

These probes run the real router against a real migrated Postgres:

| # | Probe | Result |
|---|---|---|
| 1 | bot + skill + MCP server + audit row persist; `allowAllTools=false`; exactly 1 primary session | pass |
| 2 | refused stdio bundle leaves no bot, skill, install, or server row | pass |
| 3 | refused slug collision leaves nothing behind and does not alter the existing server's endpoint | pass |
| 4 | two actors previewing identical bytes each commit independently (008) | pass |

**Red-before proof** (same probes, router reverted to `3cbeeaca`, clean DB, migrations re-applied):
4/4 fail, and the failures are diagnostic rather than generic —

- probe 1 → `expected 500 to be 200` (the audit row wrote non-existent columns: BUG-003-S1-09)
- probe 2 → `expected 2 to be 1` (a bot was created before the refusal fired: partial write)
- probe 3 → `expected 3 to be 2` (same partial-write window on the collision path)
- probe 4 → `expected 500 to be 200`

With the fix stack: 4/4 pass. The red/green pair is what makes V1/V2 live-DB rows meaningful
rather than asserted.

## Blocking finding: BUG-003-S1-05

`AGENT-BUNDLE-001` was **not** fixed by the `6b5509b3` endpoint/transport guard. A bundle that
names an existing server's slug **and** its exact endpoint passes the equality check, so import
reuses the existing row including its `secretId`, then grants it the bundle's `declaredTools`.

Runtime proof, real Postgres, after a successful 200 import:

```
      bot      |             slug             | server_has_credential | allowAllTools |                    allowedTools
---------------+------------------------------+-----------------------+---------------+----------------------------------------------------
 QA3A Imported | github-3756239-1790651381845 | t                     | f             | ["delete_repository", "read_organization_secrets"]
```

The operator's credential, the bundle author's tool list. `allowAllTools=false` is present and does
not help — the bundle is free to declare `delete_repository`, and the existing control bounds tools
to the bundle's own declaration rather than to what the operator granted.

Artifact: `.super-speckit/bugs/003-S1-mcp-slug-capability-confusion.md`. Fix dispatched to
`ss/bug/003-s1-05` (Option B: reuse only when the existing server has no credential).

## Matrix

| Row | Status | Basis |
|---|---|---|
| V1 round-trip | ✅ **verified (live DB)** | real-DB probe 1; export refusal covered by probe suite in `agent-bundle.test.ts` |
| V2 malicious bundles | ❌ **failed** | BUG-003-S1-05 runtime-confirmed; stdio and collision-with-mismatch paths verified |
| V6 machinery reuse | ✅ verified (unit) | full api suite; live-DB import now exercised for the first time |
| V8 legacy compatibility | ✅ verified | 442/442 api, 59/59 contracts, tsc clean, no regressions |
| V3 / V5 | ⬜ not-verified | S2 scope (UI + catalog seam) |
| V4 security review | ⚠️ performed, **failed** | re-run at tip: 1 high, 3 medium, 1 low |
| V7 | ⬜ not-verified | S3 scope (mobile note) |

## Honest gaps

- V2 cannot be signed off while BUG-003-S1-05 is open, even though the runtime, the secret scan,
  and the stdio path are all green. The finding is a real capability escalation, not a residual.
- The three mediums from the re-run (pathname credentials in an MCP endpoint, localhost SSRF via a
  bundle-supplied endpoint, and unbounded preview-cache retention) are recorded and open. They are
  not claimed as fixed; the prior `6b5509b3`/`f0b3a181` fixes cover query/userinfo credentials but
  not pathname credentials, and they do not bound the cache's entry count.
- `merge.require_ocr_triage_complete: true` remains unsatisfiable while `gates.ocr_review: ""`. This
  is a configuration contradiction that blocks merge on its own, independent of the code findings.
  The security-reviewer lane is a recorded substitute, not a pass.
