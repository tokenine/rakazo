# S1 Retest 6 — BUG-003-S1-07 first attempt

- **Candidate under test:** `f2d4e95f` (on top of `800eb1e4`)
- **Checker:** `omp-checker-003-s1-retest6` — independent; did not author the fix
- **Verdict:** ❌ **NOT MERGE-READY.** BUG-003-S1-07 partially closed; one medium blocks.

## Gate results

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | ✅ 460 passed / 461 (1 DB-gated probe run separately) |
| `@rakazo/contracts` | ✅ 59/59 |
| `tsc --noEmit` | ✅ clean |
| Carried-over real-Postgres reproducers (realtest3/4/5) | ✅ 12/13 — the one failure is BUG-003-S1-06, a known pre-existing low, not a regression |
| Original BUG-003-S1-07 reproducer | ✅ red at `800eb1e4` (200, secret in body) → green at `f2d4e95f` |
| New: slash-bearing secret reproducer | ❌ **red at `f2d4e95f`** — 200, secret leaks |
| New: malformed percent-escape export | ❌ **red at `f2d4e95f`** — 500 |
| Final security lane | ❌ NO-GO, 1 medium |

## What the fix got right

The original opaque-secret reproducer is genuinely closed, and the import-side placement is right:
the contracts refine cannot see `context.actor`, so `previewImport` is the correct first
actor-relative gate. Malformed escapes on the import side are already caught. Every branch that
scans loads the secrets first — no uninitialised-list bypass.

## What is still open

### BUG-003-S1-07 (medium, merge-blocking) — the check splits before matching

`AgentSecretInputSchema` allows `/` in a value (`packages/contracts/src/domain.ts:37-40`). The loop
splits the pathname, so a secret spanning a segment boundary matches nothing:

```
secret stored as: "opaque/secret"
segments scanned: ["t","opaque","secret"]
any segment contains whole secret? false
EXPORT-STATUS: 200 LEAKS-SECRET: true
```

Plus nested encoding (`%25` needs two passes), Unicode canonical equivalence, and a case where
decoding *removes* a match (`ghp_<token>%5F` → trailing underscore defeats the regex word boundary).
The full control is specified in the bug artifact; dispatched to `ss/bug/003-s1-09`.

### BUG-003-S1-08 (low, introduced by this commit) — export 500

`decodeURIComponent("%ZZ")` throws `URIError` with no guard on the export side, and
`McpRemoteEndpointSchema` accepts such endpoints, so they persist and every later export of that bot
returns 500. Runtime-confirmed: `ESCAPE-EXPORT-STATUS: 500`. The commit's own comment claims the
opposite. The import half of the same commit wrapped its loop in `try`/`catch`; the two halves
disagree, which is why the fix must be a single shared helper.

## Carried-over status

BUG-003-S1-01 … -06 all still closed at this tip (12/13 carried probes pass; the single failure is
BUG-003-S1-06, the documented `https://localhost` parse gap that is blocked at the sink and was
accepted as defence-in-depth).

## Next

`ss/bug/003-s1-09` → independent retest in a fresh worktree replaying all four of this run's
probes unchanged → one more security lane → merge decision.
