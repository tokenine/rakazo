# Static Security Review — 003 S1 at `c4d22103` and `1d9b82f7`

- **Candidates reviewed:** `c4d22103` (three residual fixes) and `1d9b82f7` (composition follow-up)
- **Lane:** independent `security-reviewer`, read-only, static; checker runtime probes noted inline
- **Verdict:** `c4d22103` ❌ NO-GO (composition gap, medium). `1d9b82f7` — convergence lane pending.

## At `c4d22103` — BUG-003-S1-10's three residuals closed, one new gap

The three named residuals were genuinely closed, each verified:

| Residual | Control | Verification |
|---|---|---|
| SEC-003-S1-13 decode budget | after `MAX_DECODE_PASSES`, a remaining escape is **refused**, not passed | `segmentHasUnresolvedEscape` → refusal |
| SEC-003-S1-14 decoder poisoning | decoding is per segment; an undecodable segment returns `undefined` and is refused | `safeDecodeSegment` → `undefined` |
| SEC-003-S1-15 one-sided NFKC | both candidates and secrets normalised with the same call | `:660,667,719-726` |

**BUG-003-S1-08 closed**: `safeDecodeSegment` no longer throws; undecodable input fails closed; both
RPC call sites reject malformed raw escapes before the helper.

### New: SEC-003-S1-16 (medium) — the composition gap

Making decoding per segment dropped a representation. The decoded segments were never reassembled:

```
pathname:  /t/opa%71ue/se%63ret
segments:  ["t","opaque","secret"]
any candidate contains "opaque/secret"? false
```

With stored secret `opaque/secret`, every candidate misses it and export serialises the endpoint.
**Runtime-confirmed by the checker**: HTTP 200 at `c4d22103`, 400 at `1d9b82f7`.

Also a **low false-positive regression**: `segmentHasUnresolvedEscape` looked for a bare `%`, so
`/files/100%25/mcp` decoded once to a trailing `%` and was refused despite being legitimate. Fixed
in `1d9b82f7` by matching a well-formed escape (`%` + two hex) instead.

## At `1d9b82f7`

Candidate set now covers three families — raw whole path; each decoded segment; the decoded segments
reassembled into a whole path plus that form's decode generations — with the reassembled form built
only when every segment decoded cleanly (otherwise the unresolved-escape check has already refused).

Runtime: `/t/opa%71ue/se%63ret` with `opaque/secret` → **400**. False-positive guards
(`/mcp`, `/api/v1/mcp`, `100%25`, singly-encoded, unrelated text) all still export.

Convergence lane verdict: see the retest9 report.

## Standing lows

AGENT-BUNDLE-010 (membership oracle), AGENT-BUNDLE-011 (cache eviction DoS), AGENT-BUNDLE-012
(public HTTP accepted then fails at runtime), BUG-003-S1-06 (`https://localhost` parses, blocked at
the sink) — unchanged.

## Standing clean claims

Prototype pollution, cross-space authorization, bundle privilege fields, path/file/SQL injection,
token replay — verified at this tip.
