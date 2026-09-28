import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { createRepos } from "./repos.js";
import { IsolationError } from "./scope.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "ws-1",
  email: "test@example.com",
  isDeploymentOwner: false,
};

const baseBot = {
  id: "bot-1",
  spaceId: "ws-1",
  userId: "user-1",
  name: "Test Bot",
  title: "",
  description: "",
  instructions: "",
  color: "#000",
  notifyOnFinish: true,
  pinned: false,
  position: 0,
  sectionId: null,
  archivedAt: null,
  parentBotId: null,
  memoryScope: null as string | null,
  createdAt: new Date("2026-08-19T00:00:00.000Z"),
  updatedAt: new Date("2026-08-19T00:00:00.000Z"),
  threads: [{ id: "thread-1", unread: false, isPrimary: true, messages: [] }],
  runs: [],
  computer: null,
};

function reposFor(memoryScope: string | null) {
  const prisma = {
    bot: {
      findMany: vi.fn(async () => [{ ...baseBot, memoryScope }]),
    },
    run: {
      findMany: vi.fn(async () => []),
    },
  };
  return createRepos(prisma as unknown as PrismaClient);
}

describe("createRepos.listBots", () => {
  it("passes memoryScope through as null when unset", async () => {
    await expect(reposFor(null).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ memoryScope: null }),
    ]);
  });

  it("passes memoryScope through when set to shared", async () => {
    await expect(reposFor("shared").listBots(actor)).resolves.toEqual([
      expect.objectContaining({ memoryScope: "shared" }),
    ]);
  });

  it("classifies initial preview runs once across bots, including non-peer results", async () => {
    const prisma = {
      bot: {
        findMany: vi.fn(async () =>
          ["one", "two"].map((id) => ({
            ...baseBot,
            id,
            threads: [
              {
                ...baseBot.threads[0],
                id: `thread-${id}`,
                messages: [
                  { runId: `run-${id}`, blocks: [{ kind: "text", text: `Answer ${id}` }] },
                ],
              },
            ],
          })),
        ),
      },
      run: { findMany: vi.fn(async () => []) },
    };

    const bots = await createRepos(prisma as unknown as PrismaClient).listBots(actor);

    expect(bots.map((bot) => bot.preview)).toEqual(["Answer one", "Answer two"]);
    expect(prisma.run.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ["run-one", "run-two"] }, trigger: "bot_message" },
      select: { id: true },
    });
  });

  it("classifies unseen runs in older pages and retains negative results between pages", async () => {
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [
          {
            ...baseBot,
            threads: [
              {
                ...baseBot.threads[0],
                messages: [
                  { seq: 30, runId: "peer-new", blocks: [{ kind: "text", text: "Hidden" }] },
                ],
              },
            ],
          },
        ]),
      },
      run: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "peer-new" }])
          .mockResolvedValueOnce([{ id: "peer-old" }]),
      },
      message: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { seq: 20, runId: "peer-old", blocks: [{ kind: "text", text: "Also hidden" }] },
            { seq: 19, runId: "user-old", blocks: [] },
          ])
          .mockResolvedValueOnce([
            { seq: 10, runId: "peer-old", blocks: [{ kind: "text", text: "Still hidden" }] },
            { seq: 9, runId: "user-old", blocks: [{ kind: "text", text: "Visible answer" }] },
          ]),
      },
    };

    const bots = await createRepos(prisma as unknown as PrismaClient).listBots(actor);

    expect(bots[0]?.preview).toBe("Visible answer");
    expect(prisma.run.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.run.findMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ["peer-old", "user-old"] }, trigger: "bot_message" },
      select: { id: true },
    });
    expect(prisma.message.findMany).toHaveBeenCalledTimes(2);
  });

  it("keeps bot-to-bot run output out of sidebar previews", async () => {
    const findMany = vi.fn(async () => [
      {
        ...baseBot,
        threads: [
          {
            ...baseBot.threads[0],
            messages: [
              {
                runId: "run-peer",
                blocks: [{ kind: "text", text: "Echoed peer reply" }],
              },
              {
                runId: "run-peer",
                blocks: [
                  {
                    kind: "bot_message_received",
                    fromBotId: "bot-2",
                    fromBotName: "Coder",
                    text: "Peer result",
                  },
                ],
              },
              { runId: "run-user", blocks: [{ kind: "text", text: "Visible answer" }] },
            ],
          },
        ],
      },
    ]);
    const prisma = {
      bot: {
        findMany,
      },
      run: {
        findMany: vi.fn(async () => [{ id: "run-peer" }]),
      },
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ preview: "Visible answer" }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          threads: {
            orderBy: SESSION_ORDER,
            include: {
              messages: { orderBy: { seq: "desc" }, take: 16 },
            },
          },
        }),
      }),
    );
  });

  it("skips a peer-run preview tail when the receipt is outside the window", async () => {
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [
          {
            ...baseBot,
            threads: [
              {
                ...baseBot.threads[0],
                messages: [
                  {
                    runId: "run-peer",
                    blocks: [{ kind: "text", text: "Echoed peer reply" }],
                  },
                  { runId: "run-user", blocks: [{ kind: "text", text: "Visible answer" }] },
                ],
              },
            ],
          },
        ]),
      },
      run: {
        findMany: vi.fn(async () => [{ id: "run-peer" }]),
      },
      message: {
        findMany: vi.fn(async () => []),
      },
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ preview: "Visible answer" }),
    ]);
  });

  it("scans older messages when the newest window is only peer output", async () => {
    const messageFindMany = vi.fn(async () => [
      { seq: 1, runId: "run-user", blocks: [{ kind: "text", text: "Older visible answer" }] },
    ]);
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [
          {
            ...baseBot,
            threads: [
              {
                ...baseBot.threads[0],
                messages: [
                  {
                    seq: 20,
                    runId: "run-peer",
                    blocks: [{ kind: "text", text: "Echoed peer reply" }],
                  },
                ],
              },
            ],
          },
        ]),
      },
      run: {
        findMany: vi.fn(async () => [{ id: "run-peer" }]),
      },
      message: {
        findMany: messageFindMany,
      },
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ preview: "Older visible answer" }),
    ]);
    expect(messageFindMany).toHaveBeenCalledWith({
      where: { threadId: "thread-1", seq: { lt: 20 } },
      orderBy: { seq: "desc" },
      take: 16,
    });
  });

  it("uses a visible message from the fourth older window for preview", async () => {
    const peerWindows = [
      [{ seq: 80, runId: "run-peer", blocks: [{ kind: "text", text: "peer 80" }] }],
      [{ seq: 60, runId: "run-peer", blocks: [{ kind: "text", text: "peer 60" }] }],
      [{ seq: 40, runId: "run-peer", blocks: [{ kind: "text", text: "peer 40" }] }],
      [{ seq: 20, runId: "run-peer", blocks: [{ kind: "text", text: "peer 20" }] }],
      [{ seq: 1, runId: "run-user", blocks: [{ kind: "text", text: "Fourth-window answer" }] }],
    ];
    let windowIndex = 0;
    const messageFindMany = vi.fn(async () => {
      windowIndex += 1;
      return peerWindows[windowIndex] ?? [];
    });
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [
          {
            ...baseBot,
            threads: [
              {
                ...baseBot.threads[0],
                messages: peerWindows[0],
              },
            ],
          },
        ]),
      },
      run: {
        findMany: vi.fn(async () => [{ id: "run-peer" }]),
      },
      message: {
        findMany: messageFindMany,
      },
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ preview: "Fourth-window answer" }),
    ]);
    expect(messageFindMany).toHaveBeenCalledTimes(4);
  });
});

describe("createRepos.listSpaceBotsForSpaces", () => {
  it("loads and maps only the compact cross-space sidebar fields", async () => {
    const findMany = vi.fn(async (_query: { where: unknown; select: Record<string, unknown> }) => [
      {
        id: "bot-2",
        spaceId: "ws-2",
        name: "Support",
        title: "Customer support",
        color: "#123456",
        notifyOnFinish: false,
        pinned: true,
        sectionId: null,
        updatedAt: new Date("2026-08-20T00:00:00.000Z"),
        parentBotId: null,
        threads: [
          {
            unread: true,
            isPrimary: true,
            messages: [{ blocks: [{ kind: "text", text: "Waiting for a reply" }] }],
          },
        ],
        runs: [{ status: "running" }],
      },
    ]);
    const repos = createRepos({ bot: { findMany } } as unknown as PrismaClient);

    await expect(repos.listSpaceBotsForSpaces(actor, ["ws-2"])).resolves.toEqual([
      {
        id: "bot-2",
        spaceId: "ws-2",
        name: "Support",
        title: "Customer support",
        color: "#123456",
        notifyOnFinish: false,
        pinned: true,
        sectionId: null,
        unread: true,
        parentBotId: null,
        preview: "Waiting for a reply",
        status: "running",
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    ]);
    const query = findMany.mock.calls[0]![0];
    expect(query.where).toEqual(
      expect.objectContaining({ spaceId: { in: ["ws-2"] }, userId: actor.userId }),
    );
    expect(query.select).not.toHaveProperty("description");
    expect(query.select).not.toHaveProperty("instructions");
    expect(query.select).not.toHaveProperty("computer");
  });
});

describe("createRepos.reorderBots", () => {
  function reorderRepos(ids: string[]) {
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      bot: {
        findMany: vi.fn().mockResolvedValue(ids.map((id) => ({ id }))),
        update,
      },
    };
    const prisma = {
      $transaction: vi.fn((run: (client: typeof tx) => Promise<void>) => run(tx)),
    };
    return { repos: createRepos(prisma as unknown as PrismaClient), update };
  }

  it("writes each owned bot's requested position", async () => {
    const { repos, update } = reorderRepos(["bot-1", "bot-2"]);
    await repos.reorderBots(actor, ["bot-2", "bot-1"]);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "bot-2" },
      data: { position: 0 },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: "bot-1" },
      data: { position: 1 },
    });
  });

  it("rejects partial or foreign bot lists before writing", async () => {
    const { repos, update } = reorderRepos(["bot-1", "bot-2"]);
    await expect(repos.reorderBots(actor, ["bot-1"])).rejects.toBeInstanceOf(IsolationError);
    await expect(repos.reorderBots(actor, ["bot-1", "foreign"])).rejects.toBeInstanceOf(
      IsolationError,
    );
    expect(update).not.toHaveBeenCalled();
  });
});

const SESSION_ORDER = [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }];
const SESSION_LIST_ORDER = [
  { isPrimary: "desc" as const },
  { lastMessageAt: { sort: "desc" as const, nulls: "last" as const } },
  { createdAt: "desc" as const },
];

interface SessionRow {
  id: string;
  botId: string;
  spaceId: string;
  userId: string;
  name: string | null;
  isPrimary: boolean;
  unread: boolean;
  createdAt: Date;
  lastMessageAt: Date | null;
}

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    botId: "bot-1",
    spaceId: "ws-1",
    userId: "user-1",
    name: null,
    isPrimary: false,
    unread: false,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    lastMessageAt: null,
    ...overrides,
  };
}

describe("createRepos.listSessions", () => {
  it("returns the bot's sessions with preview and unread, keeping the requested ordering", async () => {
    const primary = sessionRow({
      id: "session-primary",
      isPrimary: true,
      unread: true,
      name: "Main",
      createdAt: new Date("2026-09-22T00:00:00.000Z"),
      lastMessageAt: new Date("2026-09-22T00:00:00.000Z"),
    });
    const older = sessionRow({
      id: "session-older",
      createdAt: new Date("2026-09-21T00:00:00.000Z"),
    });
    const findBot = vi.fn().mockResolvedValue({ id: "bot-1" });
    const findThreads = vi.fn().mockResolvedValue([primary, older]);
    const findMessage = vi
      .fn()
      .mockResolvedValueOnce({ blocks: [{ kind: "text", text: "Newest reply" }] })
      .mockResolvedValueOnce(null);
    const prisma = {
      bot: { findFirst: findBot },
      thread: { findMany: findThreads },
      message: { findFirst: findMessage },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const sessions = await repos.listSessions(actor, "bot-1");

    expect(findBot).toHaveBeenCalledWith({
      where: { id: "bot-1", spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
      select: { id: true },
    });
    expect(findThreads).toHaveBeenCalledWith({
      where: { botId: "bot-1" },
      orderBy: SESSION_LIST_ORDER,
    });
    expect(sessions).toEqual([
      {
        id: "session-primary",
        botId: "bot-1",
        name: "Main",
        isPrimary: true,
        unread: true,
        preview: "Newest reply",
        createdAt: "2026-09-22T00:00:00.000Z",
        lastMessageAt: "2026-09-22T00:00:00.000Z",
      },
      {
        id: "session-older",
        botId: "bot-1",
        name: null,
        isPrimary: false,
        unread: false,
        preview: "",
        createdAt: "2026-09-21T00:00:00.000Z",
        lastMessageAt: null,
      },
    ]);
  });

  it("rejects bots outside the actor scope", async () => {
    const prisma = { bot: { findFirst: vi.fn().mockResolvedValue(null) } };
    const repos = createRepos(prisma as unknown as PrismaClient);
    await expect(repos.listSessions(actor, "foreign-bot")).rejects.toBeInstanceOf(IsolationError);
  });
});

describe("createRepos.createSession", () => {
  it("creates a named, non-primary session for an owned bot", async () => {
    const created = sessionRow({ id: "session-new", name: "Deep dive" });
    const create = vi.fn().mockResolvedValue(created);
    const prisma = {
      bot: { findFirst: vi.fn().mockResolvedValue({ id: "bot-1" }) },
      thread: { create },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const session = await repos.createSession(actor, "bot-1", { name: "Deep dive" });

    expect(create).toHaveBeenCalledWith({
      data: {
        spaceId: actor.spaceId,
        botId: "bot-1",
        userId: actor.userId,
        name: "Deep dive",
        isPrimary: false,
      },
    });
    expect(session).toEqual(
      expect.objectContaining({ id: "session-new", name: "Deep dive", isPrimary: false }),
    );
  });

  it("rejects foreign bots", async () => {
    const prisma = { bot: { findFirst: vi.fn().mockResolvedValue(null) } };
    const repos = createRepos(prisma as unknown as PrismaClient);
    await expect(repos.createSession(actor, "foreign-bot", { name: "X" })).rejects.toBeInstanceOf(
      IsolationError,
    );
  });
});

describe("createRepos.renameSession", () => {
  it("renames an owned session", async () => {
    const renamed = sessionRow({ id: "session-1", name: "Renamed" });
    const update = vi.fn().mockResolvedValue(renamed);
    const prisma = {
      thread: {
        findFirst: vi.fn().mockResolvedValue(sessionRow({ id: "session-1" })),
        update,
      },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const session = await repos.renameSession(actor, "session-1", "Renamed");

    expect(update).toHaveBeenCalledWith({ where: { id: "session-1" }, data: { name: "Renamed" } });
    expect(session).toEqual(expect.objectContaining({ id: "session-1", name: "Renamed" }));
  });

  it("rejects threads outside the actor scope or not owned by a bot", async () => {
    const prisma = {
      thread: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);
    await expect(repos.renameSession(actor, "foreign", "X")).rejects.toBeInstanceOf(IsolationError);
    expect(prisma.thread.update).not.toHaveBeenCalled();
  });
});

describe("createRepos.deleteSession", () => {
  function deleteRepos(rows: SessionRow[]) {
    const remove = vi.fn().mockResolvedValue(rows[0]);
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      thread: {
        findFirst: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            rows.find((row) => row.id === where.id) ?? null,
        ),
        findMany: vi.fn().mockResolvedValue(rows),
        delete: remove,
        update,
      },
    };
    const prisma = {
      $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    return { repos: createRepos(prisma as unknown as PrismaClient), remove, update };
  }

  it("deletes a non-primary session", async () => {
    const primary = sessionRow({ id: "session-primary", isPrimary: true });
    const other = sessionRow({ id: "session-other" });
    const { repos, remove, update } = deleteRepos([primary, other]);

    await repos.deleteSession(actor, "session-other");

    expect(remove).toHaveBeenCalledWith({ where: { id: "session-other" } });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to delete the bot's last remaining session", async () => {
    const only = sessionRow({ id: "session-primary", isPrimary: true });
    const { repos, remove } = deleteRepos([only]);

    await expect(repos.deleteSession(actor, "session-primary")).rejects.toThrow(
      /last remaining session/,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("promotes the earliest remaining session when the primary is deleted", async () => {
    const primary = sessionRow({
      id: "session-primary",
      isPrimary: true,
      createdAt: new Date("2026-09-25T00:00:00.000Z"),
    });
    const older = sessionRow({
      id: "session-older",
      createdAt: new Date("2026-09-21T00:00:00.000Z"),
    });
    const newer = sessionRow({
      id: "session-newer",
      createdAt: new Date("2026-09-26T00:00:00.000Z"),
    });
    const { repos, remove, update } = deleteRepos([primary, older, newer]);

    await repos.deleteSession(actor, "session-primary");

    expect(remove).toHaveBeenCalledWith({ where: { id: "session-primary" } });
    expect(update).toHaveBeenCalledWith({
      where: { id: "session-older" },
      data: { isPrimary: true },
    });
  });
});

describe("bot session pinning in bot DTOs", () => {
  it("maps threadId and unread from the primary session, not the oldest session", async () => {
    const primary = {
      id: "session-primary",
      unread: true,
      isPrimary: true,
      messages: [{ blocks: [{ kind: "text", text: "Primary preview" }] }],
    };
    const older = { id: "session-older", unread: false, isPrimary: false, messages: [] };
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [{ ...baseBot, threads: [primary, older] }]),
      },
      run: { findMany: vi.fn(async () => []) },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const bots = await repos.listBots(actor);

    expect(bots[0]).toEqual(
      expect.objectContaining({
        threadId: "session-primary",
        unread: true,
        preview: "Primary preview",
      }),
    );
  });
});
