# S1 Retest 5 — medium fixes (004 / 005 / 006)

- **Candidate under test:** `800eb1e4` (three medium fixes stacked on `61154e37`)
- **Checker:** `omp-checker-003-s1-retest5` — independent; did not author any of the three commits
- **Worktree:** `ss/qa/003-s1-retest5`, detached checkout of the immutable SHA
- **Verdict:** ✅ **all three mediums fixed.** One low-severity consistency gap found and filed.
  **S1 is now close to merge-ready; one full security lane at this tip is still required.**

## Gate results at `800eb1e4`

| Gate | Result |
|---|---|
| `@rakazo/api` full suite | ✅ **456 passed / 456** |
| `@rakazo/contracts` | ✅ 59/59 |
| `tsc --noEmit` (api + contracts) | ✅ clean |
| Real-Postgres probes carried over from retest3/4 | ✅ 5/5 — no regression to BUG-003-S1-01..05 |
| New real-Postgres medium-control probes | ⚠️ **6/7** — see below |

Note on the maker's report: it cited "62 passed" for the final suite, which is the single test file,
not the full suite. The full `@rakazo/api` run is 456. Both were green; the number was just scoped
to one file.

## Per-finding verification

### AGENT-BUNDLE-005 — non-public MCP endpoints (466a8bcf)

Rejected at **parse time** in the contracts schema, so it covers both `previewImport` and `import`
without a second API-layer check. Confirmed by real-Postgres probe: loopback, `::1`, `0.0.0.0`,
link-local, `file:`, `ftp:` all rejected; public HTTPS still accepted; a bundle carrying
`http://127.0.0.1:5432/mcp` is refused by `previewImport` and writes nothing.

**Gap found → BUG-003-S1-06 (low).** The guard applies `isLocalMcpHost()` only in the
`http:` branch, so `https://localhost/mcp` parses. Verified **not** exploitable: `assertSafeRemoteUrl`
blocks every loopback form regardless of protocol, before a socket opens. Defence-in-depth only —
filed so the comment and the code agree.

### AGENT-BUNDLE-004 — pathname credentials on export (8abb09f5)

Probe against real Postgres with a genuinely persisted `McpServer` whose endpoint carries a
`ghp_…` token in its path: **export refused (400)**, the response names the slug, and the credential
does not appear anywhere in the body. The false-positive case matters more and also passes: a bot
with `https://mcp.example.com/api/v1/mcp` **exports successfully (200)**.

### AGENT-BUNDLE-006 — unbounded preview cache (800eb1e4)

Real-Postgres probe: 60 distinct previews (each a distinct cache key) beyond the 50-entry cap. The
oldest token's commit is refused (entry evicted), and the **most recent** token still commits with
200 — the cap evicts rather than disabling. The cap and its arithmetic against `BUNDLE_MAX_BYTES`
are cited in the constant's comment.

## Open after this run

| Item | Severity | Status |
|---|---|---|
| BUG-003-S1-06 `https://localhost` parses | low | filed, not fixed — defence-in-depth, blocked at the sink |
| AGENT-BUNDLE-010 secret membership oracle | low | open, needs-review (from retest3) |
| AGENT-BUNDLE-007 | medium | ✅ closed in `3cbeeaca` (re-verified at tip) |
| BUG-003-S1-01…05 | — | ✅ all closed and re-verified at this tip |

## What S1 still needs before merge

1. A **full static security lane at `800eb1e4`**. The last one ran at `16c261cf`, three fixes behind.
   This is the gate that found the surviving high last time; it must not be assumed.
2. A decision on BUG-003-S1-06 (fix the schema/comment inconsistency, or accept it as documented
   defence-in-depth). It is low and genuinely unreachable, so accepting it with the artifact as the
   record is defensible — but it must be a decision, not a gap.
3. Re-render the matrix and release summary at this tip.
