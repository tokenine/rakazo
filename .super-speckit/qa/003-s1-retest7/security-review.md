# Merge-Gate Static Security Review — 003 S1 at `be20705e`

- **Candidate reviewed:** `be20705e` (whole-path secret scan, on top of `f2d4e95f`)
- **Lane:** independent `security-reviewer`, read-only, static
- **Verdict:** ❌ **NO-GO.** 0 critical, 0 high. BUG-003-S1-08 closed; BUG-003-S1-07 still partially
  fixed — **3 medium bypasses**, all independently verified by the checker against the code.

## What this fix got right

- The slash-boundary bypass is genuinely closed: `containsSecret` runs on the whole candidate
  without splitting (`router.ts:671-678`), and only splits for provider-pattern detection.
- One shared helper (`endpointPathRefuses`) serves both export and `previewImport` — the drift
  between the two halves of `f2d4e95f` is structurally fixed.
- Export has no serialization path around the check: invalid URLs, userinfo/query, malformed raw
  escapes and refused paths all throw before bundle construction.
- Import scans before the cache write, and commit can consume only the actor-scoped cached parse.
- **BUG-003-S1-08 is closed** — no unguarded `decodeURIComponent` remains; `%ZZ`, bare `%` and
  truncated escapes are rejected at both call sites.

## Three medium bypasses → BUG-003-S1-10

| ID | Finding | Verified |
|---|---|---|
| SEC-003-S1-13 | `MAX_DECODE_PASSES = 4` caps self-similar input; a secret encoded 5+ layers is never reconstructed. `opaque/secret` ends pass 4 as `opaque%2Fsecret`, which matches neither the plaintext nor a provider pattern. | **runtime** — export 200, 6-layer-encoded secret in the bundle, reversible in 6 decodes |
| SEC-003-S1-14 | The API guard rejects only `%` not followed by two hex digits, so `%FF` passes it — and `decodeURIComponent` on the whole pathname then throws, `safeDecodeSegment` returns the whole path unchanged, the candidate set never contains a decoded form, and a once-encoded secret elsewhere evades both detectors. | **code + harness** |
| SEC-003-S1-15 | Candidates are NFKC-normalised; stored secrets are compared raw. An NFD-stored secret against an NFD path folds away on one side only. The existing test covers stored-NFC/path-NFD and misses it. | **code + harness** |

All three reach the same leak: `agentSecrets.put` (any 1–16384-char value) → `mcp.servers.create`
→ `mcp.assignments.approve` → `agents.export` serialises the endpoint.

## Standing lows, re-checked

- **AGENT-BUNDLE-010** — confirmed low; no further RPC-surface widening at this tip.
- **AGENT-BUNDLE-011** — confirmed low; unchanged (cross-actor cache eviction DoS).
- **AGENT-BUNDLE-012** — confirmed low; unchanged (public HTTP accepted then fails at runtime).
- **BUG-003-S1-06** — confirmed low; unchanged (`https://localhost` parses, blocked at the sink).
- Cache cap steady-state is 51, not the documented 50. Bounded; cosmetic.

## Clean claims re-verified

Prototype pollution, cross-space authorization, bundle privilege fields, path/file/SQL injection,
token replay — all hold at this tip.

## Standing observation on this control

This is the fourth lane on the same 60-line function. Each round closed the case in front of it and
left a different representation of the same leak. The pattern is worth naming: the control is trying
to decide "is this string, in some representation, one of these secrets?" while an attacker chooses
the representation. Every bound added to make that decidable (a pass cap, a segment split, a
normalisation choice) has been the next bypass. The durable answer is the one `c4d22103` implements:
bound the work, then **refuse** rather than pass when the bound is reached, and apply every
transform to both sides.
