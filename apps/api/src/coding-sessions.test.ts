import { describe, expect, it } from "vitest";
import {
  BotCodingWorkspace,
  botWorkspaceKey,
  createBotCodingSession,
  CodingSessionLookup,
  listBotCodingSessions,
} from "./coding-sessions.js";

// Fake prisma covering the rows the session service touches: the lease table's
// unique constraint is emulated with a map keyed by workspaceId.
function makePrisma({ bot }: { bot?: { id: string; spaceId: string } | null }) {
  const leases = new Map<string, Record<string, unknown>>();
  const sessions: Array<Record<string, unknown>> = [];
  let seq = 0;
  const prisma = {
    bot: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        bot && bot.id === where.id ? bot : null,
    },
    codingWorkspaceLease: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const key = String(data.workspaceId);
        if (leases.has(key)) {
          const err = new Error("unique violation") as Error & { code?: string };
          err.code = "P2002";
          throw err;
        }
        leases.set(key, { ...data });
        return { ...data };
      },
      findUnique: async ({ where }: { where: { workspaceId: string } }) =>
        leases.get(where.workspaceId) ?? null,
      updateMany: async ({ where, data }: { where: { workspaceId: string }; data: Record<string, unknown> }) => {
        const row = leases.get(where.workspaceId);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    codingSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `cs-${++seq}`, ...data };
        sessions.push(row);
        return row;
      },
      findMany: async () => [...sessions].reverse(),
    },
    $transaction: async (fn: (tx: unknown) => Promise<string>) => fn(prisma),
  };
  return { prisma, sessions, leases };
}

const actor = { spaceId: "sp-1", userId: "u-1" };
type Deps = Parameters<typeof createBotCodingSession>[0];
const asDeps = (prisma: unknown): Deps => ({ prisma } as Deps);

describe("botWorkspaceKey", () => {
  it("derives a deterministic per-bot workspace key", () => {
    expect(botWorkspaceKey("b-1")).toBe("bot:b-1");
  });
});

describe("createBotCodingSession", () => {
  it("refuses bots outside the actor's space", async () => {
    const { prisma } = makePrisma({ bot: { id: "b-other", spaceId: "sp-2" } });
    await expect(
      createBotCodingSession(asDeps(prisma), actor, { botId: "b-other", engine: "normal-pi" }),
    ).rejects.toThrow("Bot not found");
  });

  it("creates a session bound to the bot workspace and reports it", async () => {
    const { prisma, sessions } = makePrisma({ bot: { id: "b-1", spaceId: "sp-1" } });
    const ref = await createBotCodingSession(
      asDeps(prisma),
      actor,
      { botId: "b-1", engine: "normal-pi", title: "Fix the login bug" },
    );
    expect(ref.workspaceId).toBe("bot:b-1");
    expect(ref.engine).toBe("normal-pi");
    expect(ref.status).toBe("active");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("Fix the login bug");
  });

  it("refuses a second session on the same workspace with the busy error", async () => {
    const { prisma } = makePrisma({ bot: { id: "b-1", spaceId: "sp-1" } });
    await createBotCodingSession(asDeps(prisma), actor, { botId: "b-1", engine: "normal-pi" });
    await expect(
      createBotCodingSession(asDeps(prisma), actor, { botId: "b-1", engine: "omp" }),
    ).rejects.toThrow(BotCodingWorkspace);
  });
});

describe("listBotCodingSessions", () => {
  it("lists only the bot's sessions in the actor's space, newest first", async () => {
    const { prisma } = makePrisma({ bot: { id: "b-1", spaceId: "sp-1" } });
    await createBotCodingSession(asDeps(prisma), actor, { botId: "b-1", engine: "normal-pi", title: "one" });
    const found = await listBotCodingSessions(asDeps(prisma), actor, "b-1");
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe("one");
    expect(found[0]).toBeInstanceOf(CodingSessionLookup);
  });
});
