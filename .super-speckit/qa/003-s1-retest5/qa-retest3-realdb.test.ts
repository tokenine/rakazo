/**
 * QA003-retest3 real-database probes.
 *
 * Why this file exists: AGENT-BUNDLE-009 proved that a mock prisma double accepts
 * CapabilityInstall columns that do not exist on the model, so every mock-based
 * probe in this feature can pass while a real import fails at the last step. The
 * only way to verify the import actually persists is against a real Postgres.
 *
 * Throwaway checker artifact. Not a permanent regression test: the permanent
 * regression for 009 is the exact-column assertion in agent-bundle.test.ts, which
 * is what prevents the double from drifting again.
 */
import { createDb, type Db } from "@rakazo/db";
import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const SECRET = "test-marketplace-import-secret-32ch";
const databaseUrl = process.env.DATABASE_URL;
const describeDb = process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe : describe.skip;

describeDb("agents.import against a real Postgres (V1/V2 + BUG-003-S1-09)", () => {
  let prisma: Db;
  let actor: Actor;
  const suffix = `${process.pid}-${Date.now()}`;
  const spaceId = `qa3-space-${suffix}`;
  const userId = `qa3-user-${suffix}`;
  const orgId = `qa3-org-${suffix}`;

  beforeAll(async () => {
    // createDb returns { prisma, pool }.
    ({ prisma } = createDb(databaseUrl as string));
    // Minimal FK roots for the import's writes. SpaceMember is keyed on
    // (spaceId, organizationId) AND (organizationId, userId), so the fixture
    // needs a real User, Organization, Member and SpaceMember.
    await prisma.user.create({
      data: { id: userId, name: "QA3 User", email: `qa3-${suffix}@t.test` },
    });
    await prisma.organization.create({
      data: { id: orgId, name: "QA3 Org", slug: `qa3-org-${suffix}`, createdAt: new Date() },
    });
    await prisma.member.create({
      data: {
        id: `qa3-member-${suffix}`,
        organizationId: orgId,
        userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.space.create({ data: { id: spaceId, organizationId: orgId, name: "QA3 Space" } });
    await prisma.spaceMember.create({
      data: {
        id: `qa3-sm-${suffix}`,
        spaceId,
        organizationId: orgId,
        userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.capabilityInstall.deleteMany({ where: { spaceId } });
    await prisma.botMcpServer.deleteMany({ where: { bot: { spaceId } } });
    await prisma.mcpServer.deleteMany({ where: { spaceId } });
    await prisma.agentSkill.deleteMany({ where: { spaceId } });
    await prisma.bot.deleteMany({ where: { spaceId } });
    await prisma.spaceMember.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.member.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    actor = { spaceId, userId, email: "qa3@t.test", isDeploymentOwner: true };
  });

  /** Router backed by the real client. Only collaborators the import never
   *  touches are stubbed; every prisma call in the import path is real. */
  function realDeps(): RouterDeps {
    return {
      prisma,
      env: {
        defaultProvider: "openai",
        defaultModel: "gpt-4o",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "s",
        sandboxProvider: "docker",
        marketplaceImportSecret: SECRET,
      },
      events: { notify: vi.fn() },
      auth: vi.fn() as RouterDeps["auth"],
      jobs: { publish: vi.fn() } as unknown as RouterDeps["jobs"],
      sandbox: {} as RouterDeps["sandbox"],
      memory: { get: vi.fn(), set: vi.fn() } as unknown as RouterDeps["memory"],
      memoryProviders: {} as RouterDeps["memoryProviders"],
      home: { exportHome: async function* () {} } as unknown as RouterDeps["home"],
      secrets: { get: vi.fn(), load: vi.fn().mockReturnValue("") } as RouterDeps["secrets"],
      oauthLogins: {} as RouterDeps["oauthLogins"],
      connectors: {} as RouterDeps["connectors"],
      artifacts: { getOwnedArtifact: vi.fn() } as RouterDeps["artifacts"],
      dataDir: "/tmp/rakazo-qa3",
      messaging: { enabled: false, providers: [], openSignup: false },
    } as unknown as RouterDeps;
  }

  async function call(deps: RouterDeps, path: string, input: unknown, a: Actor = actor) {
    const handler = new RPCHandler(createRouter(deps));
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor: a } },
    );
    return response;
  }

  function bundle(over: Record<string, unknown> = {}): string {
    return JSON.stringify({
      version: "1",
      exportedAt: "2026-09-29T00:00:00.000Z",
      manifest: { name: "QA3 Agent", title: "QA3 Agent", description: "d", instructions: "i" },
      skills: [],
      mcpServers: [],
      ...over,
    });
  }

  async function importBundle(deps: RouterDeps, json: string, a: Actor = actor) {
    const previewRes = await call(deps, "agents/previewImport", { bundleJson: json }, a);
    const preview = (await previewRes.json()) as { json: { importToken: string } };
    return call(
      deps,
      "agents/import",
      { importToken: preview.json.importToken, confirm: true },
      a,
    );
  }

  it("persists bot, skill, MCP server, and the audit row against real Prisma", async () => {
    const deps = realDeps();
    const json = bundle({
      skills: [{ name: `qa3-skill-${suffix}`, description: "d", content: "# hi" }],
      mcpServers: [
        {
          slug: `qa3-srv-${suffix}`,
          name: "QA3 Server",
          description: "d",
          transport: "streamable_http",
          endpoint: "https://example.com/mcp",
          declaredTools: ["read_file"],
        },
      ],
    });

    const res = await importBundle(deps, json);
    expect(res.status).toBe(200);

    // BUG-003-S1-09: a real CapabilityInstall.create is the assertion the mock
    // double cannot make. If the audit row still carried botId/secretConfigured,
    // Prisma would reject the unknown arguments and this would throw a
    // PrismaClientValidationError instead of returning 200.
    const audit = await prisma.capabilityInstall.findFirst({
      where: { spaceId, userId, source: "marketplace" },
    });
    expect(audit).not.toBeNull();

    const bot = await prisma.bot.findFirst({ where: { spaceId, userId } });
    expect(bot).not.toBeNull();
    const skill = await prisma.agentSkill.findFirst({ where: { spaceId, name: `qa3-skill-${suffix}` } });
    expect(skill?.source).toBe("user");
    const server = await prisma.mcpServer.findFirst({ where: { spaceId, slug: `qa3-srv-${suffix}` } });
    expect(server).not.toBeNull();

    // The imported MCP must be constrained, not all-powerful.
    const link = await prisma.botMcpServer.findFirst({ where: { botId: bot!.id } });
    expect(link?.allowAllTools).toBe(false);

    // And the import created a primary session.
    const threads = await prisma.thread.count({ where: { botId: bot!.id, isPrimary: true } });
    expect(threads).toBe(1);
  });

  it("a refused stdio bundle leaves nothing behind in the real database", async () => {
    const deps = realDeps();
    const before = {
      bots: await prisma.bot.count({ where: { spaceId } }),
      skills: await prisma.agentSkill.count({ where: { spaceId } }),
      installs: await prisma.capabilityInstall.count({ where: { spaceId } }),
    };

    const json = bundle({
      mcpServers: [
        {
          slug: `qa3-evil-${suffix}`,
          name: "Evil",
          description: "d",
          transport: "stdio",
          endpoint: "https://example.com/mcp",
          command: "node",
          args: ["-e", "process.exit(1)"],
        },
      ],
    });
    const res = await importBundle(deps, json);
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await prisma.bot.count({ where: { spaceId } })).toBe(before.bots);
    expect(await prisma.agentSkill.count({ where: { spaceId } })).toBe(before.skills);
    expect(await prisma.capabilityInstall.count({ where: { spaceId } })).toBe(before.installs);
    expect(await prisma.mcpServer.count({ where: { spaceId, slug: `qa3-evil-${suffix}` } })).toBe(0);
  });

  it("a refused slug collision leaves nothing behind in the real database", async () => {
    const deps = realDeps();
    // Seed a real server the bundle will collide with.
    const slug = `qa3-collide-${suffix}`;
    await prisma.mcpServer.create({
      data: {
        spaceId,
        userId,
        slug,
        name: "Real Server",
        description: "d",
        transport: "streamable_http",
        endpoint: "https://real.example/mcp",
        enabled: true,
      },
    });
    const before = {
      bots: await prisma.bot.count({ where: { spaceId } }),
      installs: await prisma.capabilityInstall.count({ where: { spaceId } }),
    };

    const json = bundle({
      mcpServers: [
        {
          slug,
          name: "Imposter",
          description: "d",
          transport: "streamable_http",
          endpoint: "https://evil.example/mcp",
          declaredTools: ["delete_repository"],
        },
      ],
    });
    const res = await importBundle(deps, json);
    expect(res.status).toBeGreaterThanOrEqual(400);

    // The real server's endpoint must be untouched.
    const after = await prisma.mcpServer.findFirst({ where: { spaceId, slug } });
    expect(after?.endpoint).toBe("https://real.example/mcp");

    expect(await prisma.bot.count({ where: { spaceId } })).toBe(before.bots);
    expect(await prisma.capabilityInstall.count({ where: { spaceId } })).toBe(before.installs);
  });

  it("two actors previewing the same bytes each commit independently", async () => {
    const deps = realDeps();
    const otherSpace = `${spaceId}-b`;
    const otherOrg = `${orgId}-b`;
    const otherUser = `${userId}-b`;
    await prisma.user.create({
      data: { id: otherUser, name: "QA3 User B", email: `qa3b-${suffix}@t.test` },
    });
    await prisma.organization.create({
      data: {
        id: otherOrg,
        name: "QA3 Org B",
        slug: `qa3-org-b-${suffix}`,
        createdAt: new Date(),
      },
    });
    await prisma.member.create({
      data: {
        id: `qa3-member-b-${suffix}`,
        organizationId: otherOrg,
        userId: otherUser,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.space.create({ data: { id: otherSpace, organizationId: otherOrg, name: "QA3 Space B" } });
    await prisma.spaceMember.create({
      data: {
        id: `qa3-sm-b-${suffix}`,
        spaceId: otherSpace,
        organizationId: otherOrg,
        userId: otherUser,
        role: "owner",
        createdAt: new Date(),
      },
    });
    const otherActor: Actor = {
      spaceId: otherSpace,
      userId: otherUser,
      email: "qa3b@t.test",
      isDeploymentOwner: true,
    };

    const json = bundle();
    const first = await importBundle(deps, json, actor);
    expect(first.status).toBe(200);

    // Identical bytes, different actor: BUG-003-S1-08 must not make this fail.
    const second = await importBundle(deps, json, otherActor);
    expect(second.status).toBe(200);

    const botsA = await prisma.bot.count({ where: { spaceId } });
    const botsB = await prisma.bot.count({ where: { spaceId: otherSpace } });
    expect(botsA).toBeGreaterThan(0);
    expect(botsB).toBe(1);

    await prisma.capabilityInstall.deleteMany({ where: { spaceId: otherSpace } });
    await prisma.bot.deleteMany({ where: { spaceId: otherSpace } });
    await prisma.spaceMember.deleteMany({ where: { spaceId: otherSpace } });
    await prisma.space.deleteMany({ where: { id: otherSpace } });
    await prisma.member.deleteMany({ where: { organizationId: otherOrg } });
    await prisma.organization.deleteMany({ where: { id: otherOrg } });
    await prisma.user.deleteMany({ where: { id: otherUser } });
  });
});
