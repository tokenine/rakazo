# BUG-003-S1-01 — Malformed import token crashes agents.import with HTTP 500

- Status: `confirmed`
- Found in: `003-agent-marketplace / candidate 3178940e / QA run 003-s1-run2 (independent re-verification)`
- Affected requirement: `R2 / R4 (V2 — malicious bundle rejection, import token enforcement)`, matrix row V2
- Severity: `high`
- Reproduction: `2/2 deterministic` (repeated identically across two runs; not a flake)

## Expected / actual

**Expected:** `agents.import` rejects any import token that fails HMAC verification with a typed
`UNAUTHORIZED` (HTTP 401). The task's declared security property is "token required"; a rejected token
is an ordinary client error.

**Actual:** `agents.import` returns **HTTP 500 `INTERNAL_SERVER_ERROR`** for a structurally valid token
whose HMAC segment is not 64 hex characters. The request is unauthenticated-attacker-reachable: any
authenticated actor who can call `agents/import` can trigger it.

## Minimal reproduction

1. Take any valid bundle JSON, compute `bundleHash = sha256(bundleJson)` (hex).
2. Pick a future `expiryMs`.
3. Build `importToken = "<bundleHash>.<expiryMs>.<ten hex chars>"` — HMAC segment deliberately short.
4. `POST /rpc/agents/import` with `{ importToken, confirm: true }` as any authenticated actor.
5. Observe: HTTP 500, body `{"json":{"code":"INTERNAL_SERVER_ERROR","status":500}}`.

Equivalent single-character variant (`...a`) reproduces identically.

## Root cause

`apps/api/src/router.ts`, `agents.import` handler — HMAC comparison is performed without first
normalising the provided digest to the expected length:

```ts
const expectedHmac = createHmac("sha256", secret)
  .update(`${bundleHash}.${expiryMs}`)
  .digest("hex");
if (!timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(providedHmac!))) {
  throw new ORPCError("UNAUTHORIZED", { message: "Invalid import token" });
}
```

`crypto.timingSafeEqual` throws `RangeError: Input buffers must have the same byte length` whenever the
two buffers differ in length. The token is split on `"."` and only the segment *count* is validated
(`tokenParts.length !== 3`); the HMAC segment's **length/format is never validated**. A short segment
therefore reaches `timingSafeEqual`, which throws. The `ORPCError` path is never reached, and the
unhandled `RangeError` surfaces as a 500.

This is precisely the failure mode `timingSafeEqual` is chosen to avoid: a *malformed* input is a
client error, not a candidate secret, and must not be allowed to reach the constant-time comparison.

Confirmed directly:

```
timingSafeEqual(buf('a'*64), buf('f'*64))  -> false          (intended path)
timingSafeEqual(buf('a'*64), buf('a'*10))  -> RangeError      (crash)
timingSafeEqual(buf('a'*64), buf('a'))     -> RangeError      (crash)
```

## Why the earlier QA run missed it

`003-s1-run1` claimed probe H1 "Token with wrong HMAC → HTTP 401". That probe signed tokens with
`createHmac(...).digest("hex")`, i.e. always a well-formed 64-character hex digest, so the
length-mismatch branch was never executed. The claim "21/21 probes PASS" is accurate for what was
probed and does not contradict this finding — the coverage gap is the defect's hiding place.

## Evidence

- QA run: `.super-speckit/qa/003-s1-run2/` (this run)
- Reproducer probe: `apps/api/src/qa-token-tamper-probe.test.ts` in worktree `ss/qa/003-s1-run2`
  (throwaway checker artifact; observed `TRUNCATED status=500`, `SINGLE status=500`)
- Control probes in the same file: wrong-but-equal-length HMAC → clean 401; valid HMAC with no
  preview → clean 401. This isolates the defect to *length* mismatch, not token validation generally.
- Red-capable: the probe fails on the candidate and will pass only when the handler rejects malformed
  digests without throwing.
- Sanitization completed: yes (no secrets; test-only HMAC secret `test-marketplace-import-secret-32ch`)

## Fix and regression obligation

- Bug-fix worktree/commit: `ss/bug/003-s1-01` — pending
- Regression test: add to `apps/api/src/agent-bundle.test.ts` (V2 token group) — cases for a truncated
  HMAC segment and a single-character HMAC segment, asserting a typed 4xx (`UNAUTHORIZED`) and **not** a
  5xx. These fail on `3178940e`.
- Independent retest run: pending

## Suggested fix (smallest correct)

Validate the digest length before comparing, and keep the constant-time comparison for the
equal-length case:

```ts
const expected = Buffer.from(expectedHmac, "utf8");
const provided = Buffer.from(providedHmac, "utf8");
if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
  throw new ORPCError("UNAUTHORIZED", { message: "Invalid import token" });
}
```

A stricter variant additionally requires `/^[0-9a-f]{64}$/` on the segment. Either is acceptable;
both must keep the rejection typed as `UNAUTHORIZED`.
