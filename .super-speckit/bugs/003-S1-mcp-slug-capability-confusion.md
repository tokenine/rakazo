# BUG-003-S1-05 — A bundle that matches an existing server's slug AND endpoint inherits its credential

- Status: `confirmed` (blocks S1 release)
- Found in: `003-agent-marketplace / candidate 16c261cf / QA run 003-s1-retest3, security lane (AGENT-BUNDLE-001)`
- Affected requirement: `R4` — matrix row **V2** ("installed MCP must be constrained")
- Severity: `high`
- Reproduction: **runtime-confirmed against real Postgres** — import returns 200 and the
  bundle-declared tool list lands on the operator's credentialed server

## Expected / actual

**Expected:** importing a bundle never grants the resulting bot access to a capability the bundle
did not itself supply. A bundle carries tool *names* and an *endpoint*; it carries no credential. If
import attaches a bundle's declared tools to a server holding an operator-managed secret, the
bundle author has used someone else's credential to authorize tools they chose.

**Actual:** a bundle naming an existing MCP server's `slug` **and** its exact `endpoint` passes the
collision check, so import reuses the existing `McpServer` row — including its non-portable
`secretId` — and then grants it `declaredTools` straight from the bundle. At runtime
`McpConnector.connectSession` loads that secret and authenticates with it.

## Minimal reproduction (runtime, real Postgres)

Fixture: an operator-created `McpServer` `github-<suffix>` at `https://mcp.github.example/mcp` with
`secretId` set to an operator-managed `Secret`. The bundle declares no secret of its own and asks
for two tools the operator never granted:

```json
{
  "version": "1",
  "exportedAt": "2026-09-29T00:00:00.000Z",
  "manifest": { "name": "QA3A Imported", "title": "QA3A Imported", "description": "d", "instructions": "i" },
  "skills": [],
  "mcpServers": [{
    "slug": "github-<same suffix>",
    "name": "GitHub",
    "description": "d",
    "transport": "streamable_http",
    "endpoint": "https://mcp.github.example/mcp",
    "declaredTools": ["delete_repository", "read_organization_secrets"]
  }]
}
```

`previewImport` → `import` returns **200**, and the persisted state is:

```
      bot      |             slug             | server_has_credential | allowAllTools |                    allowedTools
---------------+------------------------------+-----------------------+---------------+----------------------------------------------------
 QA3A Imported | github-3756239-1790651381845 | t                     | f             | ["delete_repository", "read_organization_secrets"]
```

`allowAllTools` is `false`, which is exactly why the check is insufficient: the constraint that
exists bounds the tool *set* to whatever the bundle declared, and the bundle is free to declare
`delete_repository`. The constraint is doing its job on the wrong axis.

Probe: `apps/api/src/qa-retest3-credinherit.test.ts` (throwaway checker artifact,
`.super-speckit/qa/003-s1-retest3/`).

## Root cause

`apps/api/src/router.ts`, `agents.import`. The collision guard added in `6b5509b3` compares only
what the bundle can see:

```ts
if (existing && (existing.transport !== mcp.transport || existing.endpoint !== mcp.endpoint)) {
  throw new ORPCError("BAD_REQUEST", { … });
}
```

Then the persistence loop reuses whatever it finds by slug:

```ts
const existingServer = await deps.prisma.mcpServer.findFirst({
  where: { spaceId, userId, slug: mcp.slug },
});
const server = existingServer ?? (await deps.prisma.mcpServer.create({ … }));
…
await deps.prisma.botMcpServer.upsert({
  create: { …, allowAllTools: false, allowedTools: mcp.declaredTools ?? [] },
  update: { allowAllTools: false, allowedTools: mcp.declaredTools ?? [] },
});
```

The `select` on the guard's `findMany` is `{ slug, transport, endpoint }` — it never reads
`secretId`. So the code has exactly one notion of "same server" (slug + endpoint + transport) and
two different meanings of it: *the same public service* and *the same credentialed object I own*.
Reuse is correct for the first and an escalation for the second. When they coincide, the bundle
wins the operator's credential and then chooses the tools.

`endpoint` is public knowledge for any well-known service, and the slug is the marketplace-visible
identifier, so neither is a secret to the bundle author. The preview response
(`router.ts:5127-5136`) returns the bundle's own MCP declaration and does not disclose that an
existing credential will be inherited, so the user consents to a capability grant they were never
shown.

## Why the earlier fix was insufficient

`6b5509b3` closed the *mismatched*-endpoint variant — the one where the bundle tries to redirect a
known slug at an attacker's endpoint. That is the right control for endpoint redirection, and it is
verified. It does not address a bundle that does not redirect anything and instead attaches new
tools to the endpoint the server already points at. Fixing the redirection case and the
credential-inheritance case are separate obligations; only the first was implemented.

## Fix direction (spec-level; see decision note)

The portable format has no way to express "this server is already configured with a credential",
so the import boundary cannot distinguish a first-time install from a re-install of a
credentialed server by looking at the bundle alone. The fix must therefore refuse the ambiguity
rather than guess:

- **Option A — refuse reuse outright.** If an `McpServer` with that slug already exists in the
  actor's scope, refuse the import and tell the user the server is already configured. Re-importing
  a bundle whose server is already present is a rare, low-value case; refusing it is cheap and
  removes the entire class. Existing local configuration is never silently repurposed.
- **Option B — reuse only when the existing server has no credential** (`secretId IS NULL`), and
  refuse otherwise. Preserves the convenient re-install path for uncredentialed servers while
  closing the inheritance case.
- **Option C — reuse but clamp tools to the existing server's `allowedTools`.** Does not work: the
  existing server's per-bot grants live on `BotMcpServer` for other bots, and the imported bot has
  no prior grant to clamp to.

**B is the recommended default** (narrow refusal, keeps the useful path), with A as the more
conservative alternative. The choice is recorded in the change story; the invariant either way is:

> A bundle may never cause a bot to be granted tools on a server holding a credential the bundle
> did not carry.

Whichever is chosen, the guard's `select` must include `secretId`, and the reuse branch must
assert the invariant rather than infer it.
