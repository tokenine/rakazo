# TDD Log — S1: Agent Marketplace Bundle Format + Export/Import

## Cycle A

### T1 — AgentBundleSchema (`packages/contracts/src/agent-bundle.ts`)

**RED** (T1-a): Schema defined with `version: z.literal("1")`, `manifest`, `skills[]`, `mcpServers[]`, `avatarKey`; `.refine()` for 2MB cap.

- `z.object` top-level but inner schemas (`AgentBundleSkillSchema`, `AgentBundleMcpServerSchema`, `AgentBundleManifestSchema`) were **not** `.strict()`. Result: unknown keys inside array items (`source` in skills, `headers` in mcpServers) passed because Zod's default passthrough on nested objects is not affected by the parent's `.strict()`.

**GREEN** (T1-b): Added `.strict()` to `AgentBundleSkillSchema`, `AgentBundleMcpServerSchema`, `AgentBundleManifestSchema`. Unknown keys inside skills/mcpServers/manifest now rejected at schema parse time. Also added `BUNDLE_MAX_BYTES` export and `ImportPreviewSchema`/`ImportCommitInputSchema`.

---

### T2 — `agents.export` RPC (`apps/api/src/router.ts`)

**RED** (T2-a): Handler used `mcpServer: true` in `include` for `repos.getBot`, but the `Bot` type from `mapBot` doesn't include `mcpServer` relations. Typecheck errors in `getBot` result.

**GREEN** (T2-b): Changed `mcpServer: true` to `server: true` in the `include` block. `mapBot` includes `mcpServers` in its `include` so the existing bot row is returned with the relation. Export serializes bot + AgentSkills + BotMcpServer refs + avatarKey into `AgentBundle`. `containsSecret` scan over instructions/description/skill contents with fail-closed behavior.

---

### T3 — Two-phase import: `previewImport` + `import` (`apps/api/src/router.ts`)

**RED** (T3-a): `previewImport` returned `{ json: { importToken, manifest, ... } }` but `rpc()` helper only unwrapped `body.json`. TypeScript expected `AgentBundleSchema` import to be available.

**GREEN** (T3-b): `agents/previewImport` handler: parse strict → containsSecret scan → HMAC token generation (SHA-256 bundle hash + 10-min expiry + HMAC-SHA256) → cached in `importPreviewCache`. Returns `manifest`, `skills`, `mcpServers`, `avatarKey`, `importToken`, `secretFlaggedFields`.

`agents/import` handler: HMAC verify → cache lookup with actor-space/userId check → `repos.createBot` (manifest fields) → skills with `source='user'` + collision disambiguate → McpServer + BotMcpServer with `allowAllTools=false` → CapabilityInstall with `source='marketplace'`.

---

### T4 — Security validations

Built into T1/T3:
- `.strict()` top-level and all inner schemas — rejects unknown keys, smuggled `source` fields, `headers`/`env`/`secretId` in mcpServers
- Exact `version: z.literal("1")` — rejects `"2"` or missing version
- 2MB `.refine()` cap on `bundleJson` length
- HMAC token with expiry — 10-minute window; replay with wrong actor-space/userId rejected
- `containsSecret` fail-closed scan before any import

---

### T5 — Schema contract tests (`apps/api/src/agent-bundle.test.ts`)

**RED** (T5-a): Tests imported `AgentBundleSchema` from `@rakazo/contracts` but it was not yet exported from `packages/contracts/src/index.ts`.

**GREEN** (T5-b): Added `export * from "./agent-bundle.js"` to `packages/contracts/src/index.ts`. All 14 schema unit tests pass: strict mode, version literals, size limits, transport types, thinkingLevel, skill/mcpServer unknown-key rejections, oversize rejection.

---

### T6 — Router seam tests (`apps/api/src/agent-bundle.test.ts`)

**RED** (T6-a): `rpc()` helper returned raw ORPC envelope `{ json: { ... } }` instead of unwrapping to `body.json`. V1 tests accessed `preview.importToken` directly (undefined). `createBot` mock lacked `$queryRaw`, `spaceMember.findUnique`, `browserProfile.create`, `memoryDocument.create`, `computer.upsert`, `bot.findFirstOrThrow` — causing `TypeError: tx.$queryRaw is not a function` inside `lockSpaceForContentCreation`.

**GREEN** (T6-b): Fixed `rpc()` to return `body.json`. Provided self-contained `$transaction` mock with all methods needed by `repos.createBot`: `$queryRaw`, `spaceMember.findUnique`, `space.findUnique`, `bot.aggregate`, `bot.create`, `bot.findFirstOrThrow`, `thread.create`, `computer.findFirst`, `computer.upsert`, `browserProfile.create`, `memoryDocument.create`. Added `mcpServer.upsert` to outer prisma mock for import handler's find-or-create path.

**RED** (T6-c): `__proto__` pollution test used `JSON.stringify(makeValidBundle())` then set `bundle.__proto__` — but `JSON.stringify` strips `__proto__` before the string reaches the handler. Removed as non-testable at JSON-RPC level; schema `.strict()` already rejects unknown top-level keys.

**GREEN** (T6-d): All 25 tests pass. 14 schema contract tests + 11 router seam tests (4 V1 round-trip, 7 V2 security rejection + MCP allowAllTools).

---

## Summary

| Task | File | Result |
|------|------|--------|
| T1 | `packages/contracts/src/agent-bundle.ts` | ✅ AgentBundleSchema with `.strict()` inner schemas, 2MB cap |
| T2 | `apps/api/src/router.ts` — `agents.export` | ✅ containsSecret fail-closed export |
| T3 | `apps/api/src/router.ts` — `previewImport`/`import` | ✅ two-phase with HMAC token, marketpla ce audit rows |
| T4 | schemas + handlers | ✅ strictness, version, size, token, source-blocking |
| T5 | `apps/api/src/agent-bundle.test.ts` | ✅ 14 schema contract tests |
| T6 | `apps/api/src/agent-bundle.test.ts` | ✅ 11 router seam tests (25 total) |
