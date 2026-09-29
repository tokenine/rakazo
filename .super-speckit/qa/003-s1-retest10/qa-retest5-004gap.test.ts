/**
 * QA003-retest5 follow-up probe for the AGENT-BUNDLE-004 residual.
 *
 * The export path scan applies detectCredentialPatterns() to each path segment
 * but never consults the space's stored secrets, so a credential that is IN the
 * secret store but has no recognizable provider prefix still leaves in the
 * bundle. The free-text scan (containsSecret against storedSecrets) is proven to
 * work for bot text; this checks whether the endpoint path is covered by it.
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

// A secret value with no provider prefix, so detectCredentialPatterns() cannot
// match it. High entropy, exactly the case the stored-secret scan exists for.
const OPAQUE_SECRET_VALUE = "Zk8vQ2xLm9TbR4pWy7NcH3";

describeDb("AGENT-BUNDLE-004 residual: stored secret in an endpoint path", () => {
  let prisma: Db;
  const suffix = `${process.pid}-${Date.now()}`;
  const spaceId = `qa34-space-${suffix}`;
  const userId = `qa34-user-${suffix}`;
  const orgId = `qa34-org-${suffix}`;

  beforeAll(async () => {
    ({ prisma } = createDb(databaseUrl as string));
    await prisma.user.create({ data: { id: userId, name: "QA34", email: `qa34-${suffix}@t.test` } });
    await prisma.organization.create({
      data: { id: orgId, name: "QA34 Org", slug: `qa34-org-${suffix}`, createdAt: new Date() },
    });
    await prisma.member.create({
      data: { id: `qa34-member-${suffix}`, organizationId: orgId, userId, role: "owner", createdAt: new Date() },
    });
    await prisma.space.create({ data: { id: spaceId, organizationId: orgId, name: "QA34 Space" } });
    await prisma.spaceMember.create({
      data: { id: `qa34-sm-${suffix}`, spaceId, organizationId: orgId, userId, role: "owner", createdAt: new Date() },
    });
  });

  afterAll(async () => {
    await prisma.capabilityInstall.deleteMany({ where: { spaceId } });
    await prisma.botMcpServer.deleteMany({ where: { bot: { spaceId } } });
    await prisma.mcpServer.deleteMany({ where: { spaceId } });
    await prisma.agentSkill.deleteMany({ where: { spaceId } });
    await prisma.bot.deleteMany({ where: { spaceId } });
    await prisma.computer.deleteMany({ where: { spaceId } });
    await prisma.thread.deleteMany({ where: { spaceId } });
    await prisma.agentSecret.deleteMany({ where: { spaceId } });
    await prisma.spaceMember.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.member.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("refuses to export an endpoint whose path contains a value held in the secret store", async () => {
    // A stored AgentSecret: the AgentSecret row plus its backing Secret row.
    // AgentSecret carries no ciphertext — the value lives on Secret.
    await prisma.secret.create({
      data: {
        id: `qa34-sid-${suffix}`,
        spaceId,
        userId,
        kind: "agent",
        ciphertext: "enc:opaque-blob",
      },
    });
    await prisma.agentSecret.create({
      data: {
        id: `qa34-secret-${suffix}`,
        spaceId,
        createdByUserId: userId,
        name: "OPAQUE_TEST",
        secretId: `qa34-sid-${suffix}`,
      },
    });

    const server = await prisma.mcpServer.create({
      data: {
        spaceId,
        userId,
        slug: `qa34-opaque-${suffix}`,
        name: "Opaque",
        description: "d",
        transport: "streamable_http",
        endpoint: `https://mcp.example.com/t/${OPAQUE_SECRET_VALUE}`,
        enabled: true,
      },
    });
    const computer = await prisma.computer.create({
      data: { spaceId, userId, scope: "team", kind: "docker", scopeKey: `qa34-c-${suffix}`, homeKey: `qa34-h-${suffix}` },
    });
    const bot = await prisma.bot.create({
      data: {
        spaceId, userId, computerId: computer.id,
        name: `qa34-bot-${suffix}`, title: "t", description: "d", instructions: "i",
        notifyOnFinish: true, color: "#4F46E5", position: 0,
      },
    });
    await prisma.botMcpServer.create({
      data: { spaceId, userId, botId: bot.id, serverId: server.id, allowAllTools: false, allowedTools: [] },
    });
    await prisma.thread.create({ data: { spaceId, userId, botId: bot.id, isPrimary: true, name: "t" } });

    const actor: Actor = { spaceId, userId, email: `qa34-${suffix}@t.test`, isDeploymentOwner: true };
    // The secret store decrypts to OPAQUE_SECRET_VALUE.
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
      secrets: { get: vi.fn(), load: vi.fn().mockReturnValue(OPAQUE_SECRET_VALUE) },
      oauthLogins: {}, connectors: {},
      artifacts: { getOwnedArtifact: vi.fn() },
      dataDir: "/tmp/rakazo-qa34",
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

    const body = await response.text();
    console.error("EXPORT-STATUS:", response.status, "LEAKS-SECRET:", body.includes(OPAQUE_SECRET_VALUE));
    // The expectation: export refuses, because the path contains a value this
    // space holds in its secret store.
    expect(response.status).toBe(400);
    // And the secret must not appear in the response body in any case.
    expect(body).not.toContain(OPAQUE_SECRET_VALUE);
  });
});
