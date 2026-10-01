# S1 Retest 4 — BUG-003-S1-05 closure

- **Candidate under test:** `61154e37` (fix for BUG-003-S1-05, on top of `16c261cf`)
- **Checker:** `omp-checker-003-s1-retest4` — independent; did not author `61154e37`
- **Worktree:** `ss/qa/003-s1-retest4`, detached checkout of the immutable SHA
- **Verdict:** ✅ **BUG-003-S1-05 closed.** S1 still not mergeable — three mediums remain open.

## What was retested

The credential-inheritance reproducer, **replayed unchanged**. The probe file was copied verbatim
from the retest3 evidence directory; it was not edited, relaxed, or rewritten to fit the fix.

## Red → green at the same seam

| | `16c261cf` (unfixed) | `61154e37` (fix) |
|---|---|---|
| credential-inheritance probe | ❌ `expected 200 to be greater than or equal to 400` | ✅ 4xx refusal |
| all 5 real-Postgres probes | 1 pass / 4 pass-blocked by the same bug | ✅ **5/5 pass** |

Red was re-measured in this worktree by reverting only `apps/api/src/router.ts` to `16c261cf` and
leaving both probe files untouched, so the pair is a true same-seam comparison rather than a
reconstruction.

## Gates at `61154e37`

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | ✅ **445 passed / 450** (5 skipped — the DB-gated probes, run separately) |
| `@rakazo/contracts` | ✅ 59/59 |
| `tsc --noEmit` (@rakazo/api) | ✅ clean |
| Real-Postgres probes (5) | ✅ 5/5 |

## The control

Option B, as decided in the bug artifact: an existing MCP server may be reused by a bundle **only
when it carries no credential**. The collision guard's `select` now includes `secretId`, and the
refusal runs in the up-front validation block — before `repos.createBot`, so a refused import
leaves nothing behind.

User-facing message:

> MCP server "<slug>" is already configured with a credential and cannot be reused by a bundle.
> Remove the existing server or choose a different slug for the bundle's server.

This keeps the convenient re-import path for uncredentialed servers while closing the escalation.
The invariant now holds: *a bundle may never cause a bot to be granted tools on a server holding a
credential the bundle did not carry.*

## Remaining on S1

Three mediums from the re-run lane, all on the same trust boundary, none claimed fixed:

- `AGENT-BUNDLE-005` — bundle endpoints validated as `z.string().url()` only; localhost/loopback
  reaches local HTTP and bypasses the remote-fetch protections.
- `AGENT-BUNDLE-004` — pathname-borne credentials (`https://host/token/SECRET`) are not caught by
  export's endpoint refusal; the endpoint is copied verbatim.
- `AGENT-BUNDLE-006` — `importPreviewCache` is unbounded; the TTL bounds an entry's life, not the
  number resident.

Plus `AGENT-BUNDLE-010` (low, needs-review) recorded and not closed.

Per `.super-speckit/docs/slice-reassessment-003-s1.md`, these are fixed before S2: the catalog
installs the very bundles under discussion, so shipping it on top of these defects would put the
marketplace one click from them.
