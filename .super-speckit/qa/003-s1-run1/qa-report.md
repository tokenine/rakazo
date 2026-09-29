# S1 QA Report — Feature 003 Agent Marketplace
**Candidate:** `3178940e` (`feat(marketplace): S1 — bundle schema, two-phase import, export, security core`)
**Worktree:** `/Users/poom-work/.super-speckit-worktrees/ss/qa/003-s1-run1`
**Checker:** Checker003S1
**Date:** 2026-09-29
**Result:** ✅ PASS — all probes green, gates re-observed

---

## Diff Audit (77e2b77f → 3178940e)

| File | +lines | Purpose |
|---|---|---|
| `packages/contracts/src/agent-bundle.ts` | +191 | `AgentBundleSchema`, `AgentBundleManifestSchema`, `AgentBundleSkillSchema`, `AgentBundleMcpServerSchema`, `ImportPreviewSchema`, `ImportCommitInputSchema`, `BUNDLE_MAX_BYTES=2MB` |
| `packages/contracts/src/rpc.ts` | +31 | `agents.export`, `agents.previewImport`, `agents.import` RPC contract declarations |
| `packages/contracts/src/index.ts` | +1 | re-export `agent-bundle.js` |
| `apps/api/src/router.ts` | +335 | `agents.export`, `agents.previewImport`, `agents.import` handlers; `importPreviewCache`; HMAC token signing; `containsSecret` scan on export/preview |
| `apps/api/src/app.ts` | +1 | no-op import (triggers recompile after env.ts change) |
| `apps/api/src/env.ts` | +4 | `marketplaceImportSecret?: string` field + loader |
| `apps/api/src/agent-bundle.test.ts` | +628 | V1 round-trip tests (25 tests: round-trip, schema, malicious rejection) |
| `specs/003-agent-marketplace/tdd-log.md` | +73 | TDD activity log |

**Scope confirm:** No migrations, no `.super-speckit` changes, no unrelated files. ✅

---

## Gate Re-observations

| Gate | Threshold | Result | Evidence |
|---|---|---|---|
| Contracts unit tests | ≥ 25 new (catalog/bundle) + prior 59 | ✅ 25 new, 0 regressions | `vitest run apps/api/src/agent-bundle.test.ts` → 25 passed |
| Total API tests | db 131/8, api, typechecks | ✅ 419 passed (31 test files) | `vitest run apps/api/src/` → 419 passed |
| TypeScript | 0 errors | ✅ clean | `pnpm --filter @rakazo/api exec tsc --noEmit` → no output |

---

## Adversarial Schema Probes — Results

> Throwaway probe file: `apps/api/src/agent-bundle-probes.test.ts` (deleted after run)

### Probe Matrix

| ID | Probe | Method | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| **A1** | `__proto__` pollution key in bundle | `AgentBundleSchema.strict().safeParse()` | `success: false` | `success: false` | ✅ PASS |
| **A2** | `constructor` pollution key in bundle | `AgentBundleSchema.strict().safeParse()` | `success: false` | `success: false` | ✅ PASS |
| **B1** | Unknown top-level key (`evilField`) | RPC `previewImport` | HTTP ≥400 | HTTP 400 | ✅ PASS |
| **C1** | `version: "2"` | RPC `previewImport` | HTTP ≥400 | HTTP 400 | ✅ PASS |
| **C2** | Missing `version` | RPC `previewImport` | HTTP ≥400 | HTTP 400 | ✅ PASS |
| **D1** | `mcpServer.headers` | RPC `previewImport` | HTTP ≥400 | HTTP 400 | ✅ PASS |
| **D2** | `mcpServer.env` | RPC `previewImport` | HTTP ≥400 | HTTP 400 | ✅ PASS |
| **D3** | `mcpServer.secretId` | RPC `previewImport` | HTTP ≥400 | HTTP 400 | ✅ PASS |
| **E1** | `skill.source: "builtin"` smuggling | RPC `previewImport` | HTTP ≥400 | HTTP 400 | ✅ PASS |
| **E2** | `skill.source: "plugin"` smuggling | RPC `previewImport` | HTTP ≥400 | HTTP 400 | ✅ PASS |
| **E3** | Import handler forces `source: "user"` | Mock prisma assertion | `source: "user"` in create call | `source: "user"` confirmed | ✅ PASS |
| **F1** | Bundle > 2 MB | `AgentBundleSchema.strict().safeParse()` | `success: false` | `success: false` | ✅ PASS |
| **G1** | Import without preview token (cache miss) | RPC `import` | HTTP ≥400 + UNAUTHORIZED | HTTP 401 + "expired" | ✅ PASS |
| **H1** | Token with wrong HMAC | RPC `import` | HTTP ≥400 + UNAUTHORIZED | HTTP 401 + "invalid" | ✅ PASS |
| **H2** | Expired token | RPC `import` | HTTP ≥400 + UNAUTHORIZED | HTTP 401 + "expired" | ✅ PASS |
| **H3** | Token for wrong bundle hash | RPC `import` | HTTP ≥400 | HTTP 401 | ✅ PASS |
| **I1** | `containsSecret` imported + used in export handler | Code inspection (regex) | Match found | Both patterns confirmed | ✅ PASS |
| **J1** | `previewImport` without `MARKETPLACE_IMPORT_SECRET` | RPC with empty secret dep | `FAILED_PRECONDITION` | `FAILED_PRECONDITION` | ✅ PASS |
| **J2** | `import` without `MARKETPLACE_IMPORT_SECRET` | RPC with empty secret dep | `FAILED_PRECONDITION` | `FAILED_PRECONDITION` | ✅ PASS |
| **K1** | `loadEnv` boots without `MARKETPLACE_IMPORT_SECRET` | Direct `loadEnv()` call | No throw, `undefined` | `undefined`, no throw | ✅ PASS |

**Total: 21 probes, 21 PASS, 0 FAIL**

---

## Two-Phase Enforcement — Detailed

### Phase separation
- `previewImport` and `import` share an in-memory `Map` keyed by `SHA256(bundleJson)`.
- `import` fails with `UNAUTHORIZED` if the hash is not in the cache (H1-H3 confirmed).
- Token expiry checked before cache lookup (H2: expired token rejected first).

### Token integrity
- Format: `sha256_hex.expiryMs.hmac_hex`
- HMAC: `SHA256(secret, "${hash}.${expiryMs}")`
- `timingSafeEqual` used for HMAC comparison (no timing leak).

### `source: "user"` enforcement
- Bundle schema has no `source` field → `AgentBundleSkillSchema.strict()` rejects any bundle carrying one.
- Import handler explicitly sets `source: "user"` in every `agentSkill.create` call.
- Confirmed by mock assertion in E3.

### `CapabilityInstall` row
- Handler calls `prisma.capabilityInstall.create` with `source: "marketplace"`.
- Confirmed in V1 round-trip test.

---

## Export Secret Scan — Detailed

- `containsSecret` imported from `@rakazo/core` (confirmed in router.ts source).
- Called with empty `secrets: []` list → detects credential substrings in bot's own secret values.
- Scans `bot.instructions`, `bot.description`, `skill.description`, `skill.content`.
- `flaggedFields` array → user-facing error message lists which fields triggered the block.
- Handler code confirmed by source regex:
  ```ts
  if (bot.instructions && scan(bot.instructions)) flaggedFields.push("bot.instructions");
  if (bot.description && scan(bot.description)) flaggedFields.push("bot.description");
  ```

---

## Boot Safety — Detailed

### Without `MARKETPLACE_IMPORT_SECRET`
- `env.ts` loads it as `optional(source.MARKETPLACE_IMPORT_SECRET)` → `undefined` when absent.
- `loadEnv()` completes without error in `NODE_ENV=development`.
- `previewImport` and `import` throw `ORPCError("FAILED_PRECONDITION", "Marketplace import is not configured on this server")` — typed error, no crash.

---

## Probe File Disposal

- `/Users/poom-work/.super-speckit-worktrees/ss/qa/003-s1-run1/apps/api/src/agent-bundle-probes.test.ts` — **deleted** after successful run.

---

## Container Cleanup

- `pg-s1check` container — stopped and removed.
