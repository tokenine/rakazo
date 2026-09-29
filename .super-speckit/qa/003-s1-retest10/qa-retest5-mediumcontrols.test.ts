/**
 * QA003-retest5 real-Postgres probes for the three medium fixes at 800eb1e4.
 *
 * The maker's tests for these are mock-based. AGENT-BUNDLE-009 (an import that
 * passed the whole mock suite and returned 500 against a real database) is the
 * precedent for not accepting mock-green as evidence on this seam, so each control
 * is re-probed here against a real client.
 *
 * Throwaway checker artifact.
 */
import { createDb, type Db } from "@rakazo/db";
import {
  AgentBundleMcpServerSchema,
  AgentBundleSchema,
} from "@rakazo/contracts";
import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const SECRET = "test-marketplace-import-secret-32ch";
const databaseUrl = process.env.DATABASE_URL;
const describeDb = process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe : describe.skip;

describeDb("medium controls at 800eb1e4 (004 endpoint path / 005 non-public endpoint / 006 cache cap)", () => {
  let prisma: Db;
  let actor: Actor;
  const suffix = `${process.pid}-${Date.now()}`;
  const spaceId = `qa35-space-${suffix}`;
  const userId = `qa35-user-${suffix}`;
  const orgId = `qa35-org-${suffix}`;

  beforeAll(async () => {
    ({ prisma } = createDb(databaseUrl as string));
    await prisma.user.create({
      data: { id: userId, name: "QA35", email: `qa35-${suffix}@t.test` },
    });
    await prisma.organization.create({
      data: { id: orgId, name: "QA35 Org", slug: `qa35-org-${suffix}`, createdAt: new Date() },
    });
    await prisma.member.create({
      data: {
        id: `qa35-member-${suffix}`,
        organizationId: orgId,
        userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.space.create({ data: { id: spaceId, organizationId: orgId, name: "QA35 Space" } });
    await prisma.spaceMember.create({
      data: {
        id: `qa35-sm-${suffix}`,
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
    actor = { spaceId, userId, email: `qa35-${suffix}@t.test`, isDeploymentOwner: true };
  });

  function deps(): RouterDeps {
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
      dataDir: "/tmp/rakazo-qa35",
      messaging: { enabled: false, providers: [], openSignup: false },
    } as unknown as RouterDeps;
  }

  async function call(d: RouterDeps, path: string, input: unknown, a: Actor = actor) {
    const handler = new RPCHandler(createRouter(d));
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
      manifest: { name: "QA35 Agent", title: "QA35", description: "d", instructions: "i" },
      skills: [],
      mcpServers: [],
      ...over,
    });
  }

  // ------------------------------------------------------------------
  // AGENT-BUNDLE-005 — non-public endpoints rejected at parse time
  // ------------------------------------------------------------------
  describe("AGENT-BUNDLE-005: non-public MCP endpoints", () => {
    it("rejects loopback, link-local, all-interfaces and non-HTTP schemes at the schema", () => {
      const base = {
        slug: "s",
        name: "n",
        description: "d",
        transport: "streamable_http",
      };
      const rejected = [
        "http://localhost:3000/mcp",
        "http://127.0.0.1:8080/mcp",
        "http://[::1]:9000/mcp",
        "http://169.254.169.254/latest/meta-data",
        "http://0.0.0.0:1234/mcp",
        "file:///etc/passwd",
        "ftp://example.com/mcp",
        "https://localhost/mcp",
        "https://127.0.0.1/mcp",
      ];
      for (const endpoint of rejected) {
        expect(
          AgentBundleMcpServerSchema.safeParse({ ...base, endpoint }).success,
          `${endpoint} must be rejected`,
        ).toBe(false);
      }
    });

    it("still accepts a public HTTPS endpoint", () => {
      for (const endpoint of [
        "https://example.com/mcp",
        "https://mcp.github.example/v1/mcp",
        "https://example.com/api/v1/mcp",
      ]) {
        expect(
          AgentBundleMcpServerSchema.safeParse({
            slug: "s",
            name: "n",
            description: "d",
            transport: "streamable_http",
            endpoint,
          }).success,
          `${endpoint} must be accepted`,
        ).toBe(true);
      }
    });

    it("previewImport refuses a bundle carrying a loopback endpoint and writes nothing", async () => {
      const d = deps();
      const before = await prisma.bot.count({ where: { spaceId } });
      const res = await call(d, "agents/previewImport", {
        bundleJson: bundle({
          mcpServers: [
            {
              slug: `qa35-evil-${suffix}`,
              name: "Evil",
              description: "d",
              transport: "streamable_http",
              endpoint: "http://127.0.0.1:5432/mcp",
              declaredTools: ["read_file"],
            },
          ],
        }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await prisma.bot.count({ where: { spaceId } })).toBe(before);
      expect(await prisma.mcpServer.count({ where: { spaceId } })).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // AGENT-BUNDLE-004 — pathname credentials refused on export
  // ------------------------------------------------------------------
  describe("AGENT-BUNDLE-004: endpoint-path credentials on export", () => {
    it("refuses to export a bot whose MCP endpoint carries a credential in its path", async () => {
      const d = deps();
      const server = await prisma.mcpServer.create({
        data: {
          spaceId,
          userId,
          slug: `qa35-pathcred-${suffix}`,
          name: "PathCred",
          description: "d",
          transport: "streamable_http",
          endpoint: `https://mcp.example.com/token/ghp_ABCDEFGHIJKLMNOPQRST`,
          enabled: true,
        },
      });
      // export requires bot.computer (router.ts:5409) and a primary thread.
      const computer = await prisma.computer.create({
        data: {
          spaceId,
          userId,
          scope: "team",
          kind: "docker",
          scopeKey: `qa35-comp-${suffix}`,
          homeKey: `qa35-home-${suffix}`,
        },
      });
      const bot = await d.prisma.bot.create({
        data: {
          spaceId,
          userId,
          computerId: computer.id,
          name: `qa35-pathbot-${suffix}`,
          title: "t",
          description: "d",
          instructions: "i",
          notifyOnFinish: true,
          color: "#4F46E5",
          position: 0,
        },
      });
      await prisma.botMcpServer.create({
        data: { spaceId, userId, botId: bot.id, serverId: server.id, allowAllTools: false, allowedTools: [] },
      });
      // repos.getBot requires a primary thread and a computer for export.
      await prisma.thread.create({
        data: { spaceId, userId, botId: bot.id, isPrimary: true, name: "t" },
      });

      const res = await call(d, "agents/export", { botId: bot.id });
      console.error("CRED-EXPORT:", res.status, await res.clone().text());
      expect(res.status).toBe(400);
      const body = await res.text();
      expect(body).toMatch(new RegExp(`qa35-pathcred-${suffix}`));
      // The credential must not appear anywhere in the refusal.
      expect(body).not.toMatch(/ghp_[A-Z0-9]{20,}/);
    });

    it("still exports a bot whose MCP endpoint has an ordinary path", async () => {
      const d = deps();
      const server = await prisma.mcpServer.create({
        data: {
          spaceId,
          userId,
          slug: `qa35-cleanpath-${suffix}`,
          name: "CleanPath",
          description: "d",
          transport: "streamable_http",
          endpoint: "https://mcp.example.com/api/v1/mcp",
          enabled: true,
        },
      });
      const computer2 = await prisma.computer.create({
        data: {
          spaceId,
          userId,
          scope: "team",
          kind: "docker",
          scopeKey: `qa35-comp2-${suffix}`,
          homeKey: `qa35-home2-${suffix}`,
        },
      });
      const bot = await prisma.bot.create({
        data: {
          spaceId,
          userId,
          computerId: computer2.id,
          name: `qa35-cleanbot-${suffix}`,
          title: "t",
          description: "d",
          instructions: "i",
          notifyOnFinish: true,
          color: "#4F46E5",
          position: 0,
        },
      });
      await prisma.botMcpServer.create({
        data: { spaceId, userId, botId: bot.id, serverId: server.id, allowAllTools: false, allowedTools: [] },
      });
      await prisma.thread.create({
        data: { spaceId, userId, botId: bot.id, isPrimary: true, name: "t" },
      });

      const res = await call(d, "agents/export", { botId: bot.id });
      console.error("CLEAN-EXPORT:", res.status, await res.clone().text());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { json: { bundleJson?: string } };
      const exported = body.json.bundleJson;
      // Whatever the envelope, a 200 means the ordinary path was not treated as a credential.
      if (typeof exported === "string") {
        expect(exported).toContain(`qa35-cleanpath-${suffix}`);
      }
    });
  });

  // ------------------------------------------------------------------
  // AGENT-BUNDLE-006 — preview cache is bounded
  // ------------------------------------------------------------------
  describe("AGENT-BUNDLE-006: preview cache capacity", () => {
    it("evicts the soonest-to-expire entry at capacity and keeps later previews working", async () => {
      const d = deps();
      // Distinct bundle bytes produce distinct cache keys, which is what the cap
      // governs. 60 distinct manifests exceeds any sane cap for a 2 MB-bounded entry.
      const tokens: string[] = [];
      for (let i = 0; i < 60; i += 1) {
        const json = bundle({ manifest: { name: `QA35 ${i}`, title: "t", description: "d", instructions: "i" } });
        const res = await call(d, "agents/previewImport", { bundleJson: json });
        expect(res.status).toBe(200);
        const parsed = (await res.json()) as { json: { importToken: string } };
        tokens.push(parsed.json.importToken);
      }

      // The oldest token's entry was evicted, so its commit can no longer land.
      const first = await call(d, "agents/import", { importToken: tokens[0], confirm: true });
      expect(first.status).toBeGreaterThanOrEqual(400);

      // A recent token is still valid: the cap evicts, it does not disable.
      const last = await call(d, "agents/import", { importToken: tokens[tokens.length - 1], confirm: true });
      expect(last.status).toBe(200);
    });
  });

  // ------------------------------------------------------------------
  // No regression: the earlier closures must still hold at this tip
  // ------------------------------------------------------------------
  it("an ordinary bundle still imports end to end", async () => {
    const d = deps();
    const res = await call(d, "agents/previewImport", {
      bundleJson: bundle({
        skills: [{ name: `qa35-skill-${suffix}`, description: "d", content: "# hi" }],
        mcpServers: [
          {
            slug: `qa35-ok-${suffix}`,
            name: "OK",
            description: "d",
            transport: "streamable_http",
            endpoint: "https://mcp.example.com/mcp",
            declaredTools: ["read_file"],
          },
        ],
      }),
    });
    const preview = (await res.json()) as { json: { importToken: string } };
    const importRes = await call(d, "agents/import", {
      importToken: preview.json.importToken,
      confirm: true,
    });
    expect(importRes.status).toBe(200);

    const bot = await prisma.bot.findFirst({ where: { spaceId, name: "QA35 Agent" } });
    expect(bot).not.toBeNull();
    const link = await prisma.botMcpServer.findFirst({ where: { botId: bot!.id } });
    expect(link?.allowAllTools).toBe(false);
  });
});
