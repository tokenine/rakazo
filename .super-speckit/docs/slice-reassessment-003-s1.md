# Slice reassessment — 003-agent-marketplace / S1

- **Assessed after:** retest 4 at `61154e37` (independent; did not author the fix)
- **Trigger:** `orchestration.reassess_after_verified_milestone_slice: true`
- **Decision:** **defer** S2 — S1 is not fully verified

## Evidence learned

1. **The mock prisma double was structurally incapable of catching a whole class of defect.**
   AGENT-BUNDLE-009 wrote `CapabilityInstall` columns (`botId`, `secretConfigured`) that do not
   exist on the model. The double accepted anything, so the whole S1 suite passed while a real
   import returned HTTP 500 at the final write. The first live-Postgres run of this feature found it
   immediately, and found a second defect the mocks also could not see.
   *Consequence:* a green S1 suite was never sufficient evidence that import works. The matrix
   should carry a live-DB row for any new persistence path, not an optional one.

2. **Every prior S1 "verified" claim rested on mock assertions.** V6 in particular was marked
   verified-unit with an explicit "no live DB assertion" caveat. That caveat was load-bearing.

3. **Two high-severity capability findings came from the same seam (MCP server reuse),** and the
   first fix closed only the variant its author had in view. Fixing the endpoint-redirection case
   created a false sense of completion on AGENT-BUNDLE-001. The second variant — inheriting an
   existing server's *credential* — was only found because the security lane was re-run against
   the new tip rather than trusted from the prior report.

4. **The static security lane is load-bearing, not decorative.** It found both 001 findings and the
   010 oracle. It cannot satisfy a runtime row, but removing it would have left all three open.

5. **Stale state is a failure mode of its own.** The index said `qa_failed` at a SHA seven commits
   behind, with an eighth fix uncommitted. Git, not the index, was the source of truth. Any
   orchestrator resuming from the index alone would have re-fixed closed bugs.

## Impact on roadmap

| Remaining slice | Decision | Rationale | Requirements and evidence affected |
| --- | --- | --- | --- |
| S1 closure (mediums 004/005/006) | **keep, before S2** | All three are on the same import/export trust boundary S1 introduced. Shipping S2 — a catalog that *installs* bundles — on top of an unbounded preview cache, a localhost-SSRF-reachable endpoint validator, and a pathname-credential leak in export would put the marketplace one click from those defects. | V2 (SSRF variant), V1 (pathname credential variant), plus the availability row 006 covers |
| S1 final security lane + merge | **keep** | A lane run against the post-medium tip is required; the last one was at `16c261cf`, two fixes behind. | V4 |
| S2 marketplace UI + catalog seam | **defer** | Depends on the S1 boundary being closed. The catalog is the consumer that makes these defects reachable at scale. | V3, V5 |
| S3 security review + closure | **reorder: pull forward** | Originally the last slice. Evidence shows the review must run continuously on this trust boundary, not once at the end. Run the lane after the mediums, then again at S2's boundary. | V4, V7 |

## Next route

**Next slice: S1-closure mediums, in one bug lane, in this order.**

1. `AGENT-BUNDLE-005` — bundle endpoints are validated as `z.string().url()` only, so a localhost or
   `127.0.0.1` endpoint persists and later opts into local HTTP, bypassing `createSafeRemoteFetch`
   and the DNS-pinning checks. Highest reachability of the three: an imported bot can induce
   server-side POSTs to loopback services.
2. `AGENT-BUNDLE-004` — query/userinfo credentials in an MCP endpoint are refused on export, but
   a credential in the pathname is not, and the endpoint is copied verbatim.
3. `AGENT-BUNDLE-006` — `importPreviewCache` is an unbounded map. The TTL and prune bound an
   entry's lifetime; they do not bound how many are resident. Needs a size cap.

**Feedback loop:** extend the existing real-Postgres probe file rather than adding a new harness —
same container recipe (`postgres:17-alpine`, `prisma migrate deploy`, `VERIFY_DATABASE=1`). Each
medium needs a red-before at the current tip and a green-after against real Postgres, not a mock.
Re-run the static lane afterwards; if it reports any high, the mediums are not done.

**Merge condition for S1:** all three mediums closed, security lane clean at the final tip, matrix
rows V1/V2/V4/V6/V8 verified with live-DB evidence, then `ready_for_merge` → merge.
