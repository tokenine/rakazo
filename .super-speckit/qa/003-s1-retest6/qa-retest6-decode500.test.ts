/**
 * QA003-retest6 probe: a malformed percent-escape in a persisted MCP endpoint
 * reaches the unguarded decodeURIComponent() in the export path loop and becomes
 * a 500. McpRemoteEndpointSchema accepts these endpoints (proved in
 * qa-retest6-decode.test.ts), so they can be persisted via mcp.servers.create.
 *
 * Throwaway checker artifact.
 */
import { createDb, type Db } from "@rakazo/db";
import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe : describe.skip;

describeDb("export with a malformed percent-escape endpoint", () => {
  let prisma: Db;
  const suffix = `${process.pid}-${Date.now()}`;
  const spaceId = `qa36-space-${suffix}`;
  const userId = `qa36-user-${suffix}`;
  const orgId = `qa36-org-${suffix}`;

  beforeAll(async () => {
    ({ prisma } = createDb(databaseUrl as string));
    await prisma.user.create({ data: { id: userId, name: "QA36", email: `qa36-${suffix}@t.test` } });
    await prisma.organization.create({
      data: { id: orgId, name: "QA36 Org", slug: `qa36-org-${suffix}`, createdAt: new Date() },
    });
    await prisma.member.create({
      data: { id: `qa36-member-${suffix}`, organizationId: orgId, userId, role: "owner", createdAt: new Date() },
    });
    await prisma.space.create({ data: { id: spaceId, organizationId: orgId, name: "QA36 Space" } });
    await prisma.spaceMember.create({
      data: { id: `qa36-sm-${suffix}`, spaceId, organizationId: orgId, userId, role: "owner", createdAt: new Date() },
    });
  });

  afterAll(async () => {
    await prisma.botMcpServer.deleteMany({ where: { bot: { spaceId } } });
    await prisma.mcpServer.deleteMany({ where: { spaceId } });
    await prisma.bot.deleteMany({ where: { spaceId } });
    await prisma.computer.deleteMany({ where: { spaceId } });
    await prisma.thread.deleteMany({ where: { spaceId } });
    await prisma.spaceMember.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.member.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("returns a clean 4xx, not a 500, for a malformed percent-escape", async () => {
    const server = await prisma.mcpServer.create({
      data: {
        spaceId,
        userId,
        slug: `qa36-esc-${suffix}`,
        name: "Escaped",
        description: "d",
        transport: "streamable_http",
        // Rejected by neither McpRemoteEndpointSchema nor URL parsing.
        endpoint: "https://mcp.example.com/t/%ZZ",
        enabled: true,
      },
    });
    const computer = await prisma.computer.create({
      data: { spaceId, userId, scope: "team", kind: "docker", scopeKey: `qa36-c-${suffix}`, homeKey: `qa36-h-${suffix}` },
    });
    const bot = await prisma.bot.create({
      data: {
        spaceId, userId, computerId: computer.id,
        name: `qa36-bot-${suffix}`, title: "t", description: "d", instructions: "i",
        notifyOnFinish: true, color: "#4F46E5", position: 0,
      },
    });
    await prisma.botMcpServer.create({
      data: { spaceId, userId, botId: bot.id, serverId: server.id, allowAllTools: false, allowedTools: [] },
    });
    await prisma.thread.create({ data: { spaceId, userId, botId: bot.id, isPrimary: true, name: "t" } });

    const actor: Actor = { spaceId, userId, email: `qa36-${suffix}@t.test`, isDeploymentOwner: true };
    const deps = {
      prisma,
      env: {
        defaultProvider: "openai", defaultModel: "gpt-4o",
        webOrigin: "http://127.0.0.1:5173", screenProxySecret: "s",
        sandboxProvider: "docker", marketplaceImportSecret: "test-marketplace-import-secret-32ch",
      },
      events: { notify: vi.fn() },
      auth: vi.fn(),
      jobs: { publish: vi.fn() },
      sandbox: {},
      memory: { get: vi.fn(), set: vi.fn() },
      memoryProviders: {},
      home: { exportHome: async function* () {} },
      secrets: { get: vi.fn(), load: vi.fn().mockReturnValue("") },
      oauthLogins: {}, connectors: {},
      artifacts: { getOwnedArtifact: vi.fn() },
      dataDir: "/tmp/rakazo-qa36",
      messaging: { enabled: false, providers: [], openSignup: false },
    } as unknown as RouterDeps;

    const handler = new RPCHandler(createRouter(deps));
    const { response } = await handler.handle(
      new Request("http://127.0.0.1/rpc/agents/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { botId: bot.id } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );

    console.error("ESCAPE-EXPORT-STATUS:", response.status);
    // A malformed escape is a client-supplied input problem: it must be a 4xx.
    expect(response.status).toBe(400);
  });
});
