import type { PrismaClient } from "@rakazo/db";
import {
  createCodingSession,
  createSessionServiceDeps,
  WorkspaceBusyError,
} from "@rakazo/adapters";

/**
 * Bot-scoped coding sessions (004 T6 sliver): every bot owns one deterministic
 * workspace, so "start coding" needs no repo picker — the session binds to the
 * bot's workspace and the exclusive lease enforces one active session per bot.
 */
export function botWorkspaceKey(botId: string): string {
  return `bot:${botId}`;
}

export class BotNotFoundError extends Error {
  constructor() {
    super("Bot not found");
    this.name = "BotNotFoundError";
  }
}

export class BotCodingWorkspace extends WorkspaceBusyError {}

type CodingSessionsPrisma = Pick<PrismaClient, "bot" | "codingSession">;

async function requireSpaceBot(
  prisma: CodingSessionsPrisma,
  actor: { spaceId: string },
  botId: string,
): Promise<{ id: string; spaceId: string }> {
  const bot = (await prisma.bot.findUnique({
    where: { id: botId },
    select: { id: true, spaceId: true },
  })) as { id: string; spaceId: string } | null;
  if (!bot || bot.spaceId !== actor.spaceId) throw new BotNotFoundError();
  return bot;
}

export async function createBotCodingSession(
  deps: { prisma: CodingSessionsPrisma },
  actor: { spaceId: string; userId: string },
  input: { botId: string; engine: "normal-pi" | "omp"; title?: string },
): Promise<{ id: string; workspaceId: string; engine: "normal-pi" | "omp"; status: string }> {
  await requireSpaceBot(deps.prisma, actor, input.botId);
  try {
    const ref = await createCodingSession(
      createSessionServiceDeps({
        // The real API prisma client satisfies the full service deps; this
        // module only relies on the two models plus $transaction.
        prisma: deps.prisma as unknown as Parameters<typeof createSessionServiceDeps>[0]["prisma"],
      }),
      {
        workspaceId: botWorkspaceKey(input.botId),
        engine: input.engine,
        spaceId: actor.spaceId,
        userId: actor.userId,
        botId: input.botId,
        ...(input.title ? { title: input.title } : {}),
      },
    );
    return { id: ref.id, workspaceId: ref.workspaceId, engine: ref.engine, status: "active" };
  } catch (error) {
    if (error instanceof WorkspaceBusyError) throw new BotCodingWorkspace(input.botId, error.message);
    throw error;
  }
}

export class CodingSessionLookup {
  readonly id: string;
  readonly workspaceId: string;
  readonly engine: string;
  readonly status: string;
  readonly title: string | null;

  constructor(row: {
    id: string;
    workspaceId: string;
    engine: string;
    status: string;
    title?: string | null;
  }) {
    this.id = row.id;
    this.workspaceId = row.workspaceId;
    this.engine = row.engine;
    this.status = row.status;
    this.title = row.title ?? null;
  }
}

export async function listBotCodingSessions(
  deps: { prisma: CodingSessionsPrisma },
  actor: { spaceId: string },
  botId: string,
): Promise<CodingSessionLookup[]> {
  await requireSpaceBot(deps.prisma, actor, botId);
  const rows = await deps.prisma.codingSession.findMany({
    where: { botId, spaceId: actor.spaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(
    (row) =>
      new CodingSessionLookup(row as {
        id: string;
        workspaceId: string;
        engine: string;
        status: string;
        title?: string | null;
      }),
  );
}
