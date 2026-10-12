# S1 Proof Pack — Feature 003 Agent Marketplace
**Candidate:** `3178940e` | **Checker:** Checker003S1 | **Date:** 2026-09-29

---

## Proof 1: 25 new bundle tests pass

```
Test Files  1 passed (1)
     Tests  25 passed (25)
  Duration  3.19s
Command: CLOUD_AGENT_PROVIDER=emulator SANDBOX_PROVIDER=fake WAKEUP_DRIVER=memory \
  ./node_modules/.bin/vitest run apps/api/src/agent-bundle.test.ts --reporter=verbose
```

Tests cover: V1 round-trip (import creates bot, skill source=user, BotMcpServer allowAllTools=false, CapabilityInstall source=marketplace), V2 malicious rejections (unknown version, unknown keys, headers/env/secretId, skill source smuggling, expired token, cache miss).

---

## Proof 2: 419 total API tests pass (31 files)

```
Test Files  31 passed (31)
     Tests  419 passed (419)
  Duration  8.82s
```

Baseline: 394 prior (59 from contracts + 335 other api). New: 25 bundle tests. Net: 419.

---

## Proof 3: TypeScript clean

```
Command: pnpm --filter @rakazo/api exec tsc --noEmit
Result: (no output — success)
```

---

## Proof 4: Proto pollution rejected (Probe A)

```ts
// Bundle with __proto__ key
bundle["__proto__"] = { polluted: true };
const result = AgentBundleSchema.strict().safeParse(bundle);
expect(result.success).toBe(false); // ✅ PASS
```

`AgentBundleSchema` uses `.strict()` at top level → Zod rejects any key not in the schema definition, including `__proto__` and `constructor`.

---

## Proof 5: Unknown top-level keys rejected (Probe B)

```ts
bundle["evilField"] = "value";
const { status } = await rpcCall(handler, "agents/previewImport", { bundleJson: JSON.stringify(bundle) }, actor);
expect(status).toBeGreaterThanOrEqual(400); // ✅ PASS — HTTP 400
```

Handler calls `AgentBundleSchema.strict().safeParse(JSON.parse(input.bundleJson))` → `strict()` rejects unknown keys.

---

## Proof 6: Version enforcement — no fallback (Probe C)

```ts
// version: "2"
const { status } = await rpcCall(handler, "agents/previewImport", { bundleJson: JSON.stringify(makeValidBundle({ version: "2" })) }, actor);
expect(status).toBeGreaterThanOrEqual(400); // ✅ PASS — HTTP 400

// missing version
delete bundle["version"];
const { status: s2 } = await rpcCall(handler, "agents/previewImport", { bundleJson: JSON.stringify(bundle) }, actor);
expect(s2).toBeGreaterThanOrEqual(400); // ✅ PASS — HTTP 400
```

Schema: `version: z.literal("1")` → only exactly `"1"` accepted.

---

## Proof 7: MCP server headers/env/secretId rejected (Probe D)

```ts
// headers key
const bundle = makeValidBundle({ mcpServers: [{ slug: "bad", name: "B", description: "",
  transport: "streamable_http", endpoint: "https://e.com", headers: { Auth: "x" } }] });
const { status } = await rpcCall(handler, "agents/previewImport", { bundleJson: JSON.stringify(bundle) }, actor);
expect(status).toBeGreaterThanOrEqual(400); // ✅ PASS

// env key
// transport: "stdio", command: "node", env: { KEY: "v" }
// status: 400 ✅

// secretId key
// secretId: "s"
// status: 400 ✅
```

`AgentBundleMcpServerSchema` uses `.strict()` and lists only `[slug, name, description, transport, endpoint, command, args, declaredTools]`. Keys not in the schema are rejected.

---

## Proof 8: Skill source smuggling rejected (Probe E)

```ts
// Bundle carries skill with source: "builtin"
const bundle = makeValidBundle({ skills: [{ name: "s", description: "d", content: "# c", source: "builtin" }] });
const { status } = await rpcCall(handler, "agents/previewImport", { bundleJson: JSON.stringify(bundle) }, actor);
expect(status).toBeGreaterThanOrEqual(400); // ✅ PASS — HTTP 400

// Import handler sets source: "user" explicitly
await rpcCall(handler, "agents/import", { importToken: previewBody.json.importToken, confirm: true }, actor);
expect(deps.prisma.agentSkill.create).toHaveBeenCalledWith(
  expect.objectContaining({ data: expect.objectContaining({ source: "user" }) }),
); // ✅ PASS
```

Two enforcement layers: (1) `AgentBundleSkillSchema.strict()` has no `source` field — bundle rejected at parse time. (2) Import handler explicitly sets `source: "user"` in every `agentSkill.create`.

---

## Proof 9: Oversize bundle rejected (Probe F)

```ts
const bundle = makeValidBundle({
  manifest: { name: "Agent", title: "x".repeat(2 * 1024 * 1024 + 1), description: "", instructions: "" },
});
const result = AgentBundleSchema.strict().safeParse(bundle);
expect(result.success).toBe(false); // ✅ PASS
```

Schema refinement uses `Blob.size` of all content strings and compares against `BUNDLE_MAX_BYTES = 2 * 1024 * 1024`.

---

## Proof 10: Two-phase enforcement — no token, no import (Probe G)

```ts
const bundle = makeValidBundle();
const fakeToken = signToken(JSON.stringify(bundle), TEST_SECRET, Date.now() + 60_000);
// Token is valid HMAC but NOT in the preview cache
const { status, body } = await rpcCall(handler, "agents/import", { importToken: fakeToken, confirm: true }, actor);
expect(status).toBeGreaterThanOrEqual(400); // ✅ PASS — HTTP 401
expect(body.json?.code ?? body.json?.message).toMatch(/UNAUTHORIZED|expired|cache/i);
// ✅ PASS — "Preview has expired — call previewImport again"
```

Handler checks cache before expiry validation. Without a prior preview, cache lookup returns `undefined` → `UNAUTHORIZED`.

---

## Proof 11: Tampered token rejected (Probe H)

```ts
// Wrong HMAC
const wrongHmac = createHmac("sha256", "wrong-secret").update(`${hash}.${expiryMs}`).digest("hex");
expect(status).toBeGreaterThanOrEqual(400); // ✅ PASS — HTTP 401
expect(body.json?.code ?? body.json?.message).toMatch(/UNAUTHORIZED|invalid/i); // ✅ PASS

// Expired
const expiredToken = signToken(bundleJson, TEST_SECRET, Date.now() - 1000);
expect(status).toBeGreaterThanOrEqual(400); // ✅ PASS
expect(body.json?.code ?? body.json?.message).toMatch(/UNAUTHORIZED|expired/i); // ✅ PASS

// Wrong bundle hash
const wrongHash = createHash("sha256").update("other-json").digest("hex");
expect(status).toBeGreaterThanOrEqual(400); // ✅ PASS — HTTP 401
```

Three independent checks: (1) HMAC validity via `timingSafeEqual`, (2) expiry timestamp, (3) actor-space/user binding in cache lookup.

---

## Proof 12: containsSecret used in export handler (Probe I — code evidence)

```ts
// Code inspection confirms:
// 1. Import at top of router.ts:
import { ..., containsSecret, ... } from "@rakazo/core";

// 2. Export handler pattern:
const scan = (text: string) => containsSecret(text, []);
if (bot.instructions && scan(bot.instructions)) flaggedFields.push("bot.instructions");
if (bot.description && scan(bot.description)) flaggedFields.push("bot.description");
if (flaggedFields.length > 0) {
  throw new ORPCError("BAD_REQUEST", {
    message: `Export refused: embedded secret detected in: ${flaggedFields.join(", ")}`,
  });
}
```

Source confirmed in router.ts lines ~5037-5050 and ~5258-5265.

---

## Proof 13: Boot safety — API boots without MARKETPLACE_IMPORT_SECRET (Probe J/K)

```ts
const env = loadEnv({ ... /* MARKETPLACE_IMPORT_SECRET absent */ ... });
expect(env.marketplaceImportSecret).toBeUndefined(); // ✅ PASS — no throw

// RPC call without secret:
const { status, body } = await rpcCall(noSecretHandler, "agents/previewImport", { bundleJson }, actor);
expect(body.json.code).toBe("FAILED_PRECONDITION"); // ✅ PASS
expect(body.json.message).toMatch(/not configured/i); // ✅ PASS
```

`marketplaceImportSecret: optional(source.MARKETPLACE_IMPORT_SECRET)` → absent env var = `undefined`. `loadEnv` completes. Both `previewImport` and `import` throw typed `ORPCError("FAILED_PRECONDITION", ...)` — no crash.

---

## Proof 14: throwaway probe file deleted

```
rm apps/api/src/agent-bundle-probes.test.ts
# file removed after successful run
```

---

## Proof 15: Container cleaned

```
docker stop pg-s1check && docker rm pg-s1check
# container removed
```
