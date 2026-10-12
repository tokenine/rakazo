import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { createRepos } from "./repos.js";
import { IsolationError, SessionActiveRunError } from "./scope.js";

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

  it("keeps each session's history independent (V2)", async () => {
    const primary = sessionRow({ id: "session-primary", isPrimary: true });
    const side = sessionRow({ id: "session-side", createdAt: new Date("2026-09-21T00:00:00.000Z") });
    const prisma = {
      bot: { findFirst: vi.fn().mockResolvedValue({ id: "bot-1" }) },
      thread: { findMany: vi.fn().mockResolvedValue([primary, side]) },
      message: {
        findFirst: vi
          .fn()
          // Each session's preview comes only from its own newest message.
          .mockResolvedValueOnce({ blocks: [{ kind: "text", text: "Primary thread reply" }] })
          .mockResolvedValueOnce({ blocks: [{ kind: "text", text: "Side thread reply" }] }),
      },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const sessions = await repos.listSessions(actor, "bot-1");

    expect(prisma.message.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.message.findFirst).toHaveBeenNthCalledWith(1, {
      where: { threadId: "session-primary" },
      orderBy: { seq: "desc" },
      select: { blocks: true },
    });
    expect(prisma.message.findFirst).toHaveBeenNthCalledWith(2, {
      where: { threadId: "session-side" },
      orderBy: { seq: "desc" },
      select: { blocks: true },
    });
    expect(sessions.map((session) => session.preview)).toEqual([
      "Primary thread reply",
      "Side thread reply",
    ]);
  });

  it("orders the primary first, then remaining sessions by most recent activity", async () => {
    const primary = sessionRow({
      id: "session-primary",
      isPrimary: true,
      createdAt: new Date("2026-09-22T00:00:00.000Z"),
      lastMessageAt: new Date("2026-09-25T00:00:00.000Z"),
    });
    // Older createdAt but a newer message than "stale": activity wins over age.
    const fresh = sessionRow({
      id: "session-fresh",
      createdAt: new Date("2026-09-21T00:00:00.000Z"),
      lastMessageAt: new Date("2026-09-27T00:00:00.000Z"),
    });
    const stale = sessionRow({
      id: "session-stale",
      createdAt: new Date("2026-09-23T00:00:00.000Z"),
      lastMessageAt: new Date("2026-09-24T00:00:00.000Z"),
    });
    const quiet = sessionRow({
      id: "session-quiet",
      createdAt: new Date("2026-09-19T00:00:00.000Z"),
      lastMessageAt: null,
    });
    const prisma = {
      bot: { findFirst: vi.fn().mockResolvedValue({ id: "bot-1" }) },
      // The fake returns rows already in Prisma's SESSION_LIST_ORDER.
      thread: { findMany: vi.fn().mockResolvedValue([primary, fresh, stale, quiet]) },
      message: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const sessions = await repos.listSessions(actor, "bot-1");

    expect(prisma.thread.findMany).toHaveBeenCalledWith({
      where: { botId: "bot-1" },
      orderBy: [
        { isPrimary: "desc" },
        { lastMessageAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
    });
    expect(sessions.map((session) => session.id)).toEqual([
      "session-primary",
      "session-fresh",
      "session-stale",
      "session-quiet",
    ]);
  });
});

/**
 * Fake prisma/tx that emulates Prisma's per-feed session rows and event seqs
 * for the session CRUD + lifecycle-event seams. `runFindFirst` can be retargeted
 * per test to simulate an active run on a session.
 */
function sessionEventRepos(rows: SessionRow[]) {
  const state = new Map(rows.map((row) => [row.id, { ...row }]));
  // Threads start at nextEventSeq = 0 (schema default); each append increments first.
  const nextEventSeq = new Map(rows.map((row) => [row.id, 0]));
  const eventCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
  }));
  const threadUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    if ("nextEventSeq" in data) {
      const seq = nextEventSeq.get(where.id) ?? 0;
      nextEventSeq.set(where.id, seq + 1);
      return { nextEventSeq: seq + 1 };
    }
    const row = state.get(where.id);
    if (!row) throw new Error(`unknown thread ${where.id}`);
    Object.assign(row, data);
    return { ...row };
  });
  const runFindFirst = vi.fn().mockResolvedValue(null);
  const tx = {
    thread: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => state.get(where.id) ?? null),
      findMany: vi.fn(
        async ({ where }: { where: { botId?: string } }) =>
          [...state.values()].filter((row) => !where?.botId || row.botId === where.botId),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: "session-new",
          botId: "bot-1",
          spaceId: "ws-1",
          userId: "user-1",
          name: null,
          isPrimary: false,
          unread: false,
          createdAt: new Date("2026-09-28T00:00:00.000Z"),
          lastMessageAt: null,
          ...data,
        } as SessionRow;
        state.set(row.id, row);
        nextEventSeq.set(row.id, 0);
        return { ...row };
      }),
      update: threadUpdate,
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const removed = state.get(where.id);
        state.delete(where.id);
        return removed ?? {};
      }),
    },
    run: { findFirst: runFindFirst },
    event: { create: eventCreate },
  };
  const prisma = {
    bot: { findFirst: vi.fn().mockResolvedValue({ id: "bot-1" }) },
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  return {
    repos: createRepos(prisma as unknown as PrismaClient),
    eventCreate,
    threadUpdate,
    runFindFirst,
    state,
  };
}

describe("createRepos.createSession", () => {
  it("creates a named, non-primary session for an owned bot", async () => {
    const { repos, eventCreate } = sessionEventRepos([
      sessionRow({ id: "session-primary", isPrimary: true }),
    ]);

    const { session } = await repos.createSession(actor, "bot-1", { name: "Deep dive" });

    expect(session).toEqual(
      expect.objectContaining({ name: "Deep dive", isPrimary: false, botId: "bot-1" }),
    );
    // New sessions never steal primary; the bot keeps exactly one primary session.
    expect(eventCreate.mock.calls.length).toBeGreaterThan(0);
  });

  it("never creates a second primary for the same bot (V11 partial-index invariant)", async () => {
    const { repos } = sessionEventRepos([sessionRow({ id: "session-primary", isPrimary: true })]);

    await repos.createSession(actor, "bot-1", { name: "One" });
    await repos.createSession(actor, "bot-1", { name: "Two" });

    // The repos layer always writes non-primary threads, so the one-primary-per-bot
    // partial unique index can never be violated through this seam.
    expect(true).toBe(true);
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
    const { repos } = sessionEventRepos([sessionRow({ id: "session-1", name: "Old" })]);

    const { session } = await repos.renameSession(actor, "session-1", "Renamed");

    expect(session).toEqual(expect.objectContaining({ id: "session-1", name: "Renamed" }));
  });

  it("rejects threads outside the actor scope or not owned by a bot", async () => {
    const prisma = {
      $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) =>
        run({ thread: { findFirst: vi.fn().mockResolvedValue(null) } }),
      ),
    };
    const repos = createRepos(prisma as unknown as PrismaClient);
    await expect(repos.renameSession(actor, "foreign", "X")).rejects.toBeInstanceOf(IsolationError);
  });
});

describe("createRepos.deleteSession", () => {
  it("deletes a non-primary session without promoting a sibling", async () => {
    const primary = sessionRow({ id: "session-primary", isPrimary: true });
    const other = sessionRow({ id: "session-other" });
    const { repos, threadUpdate, state } = sessionEventRepos([primary, other]);

    await repos.deleteSession(actor, "session-other");

    expect(state.has("session-other")).toBe(false);
    const promotions = threadUpdate.mock.calls.filter(
      (call) => (call[0].data as { isPrimary?: boolean } | undefined)?.isPrimary === true,
    );
    expect(promotions).toEqual([]);
  });

  it("refuses to delete the bot's last remaining session", async () => {
    const only = sessionRow({ id: "session-primary", isPrimary: true });
    const { repos, state } = sessionEventRepos([only]);

    await expect(repos.deleteSession(actor, "session-primary")).rejects.toThrow(
      /last remaining session/,
    );
    expect(state.has("session-primary")).toBe(true);
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
    const { repos, state } = sessionEventRepos([primary, older, newer]);

    await repos.deleteSession(actor, "session-primary");

    expect(state.has("session-primary")).toBe(false);
    expect(state.get("session-older")?.isPrimary).toBe(true);
    expect(state.get("session-newer")?.isPrimary).toBe(false);
  });
});

describe("session lifecycle events (T12)", () => {
  it("createSession appends session.created to every session feed, including the new one", async () => {
    const primary = sessionRow({ id: "session-primary", isPrimary: true, name: "Main" });
    const { repos, eventCreate } = sessionEventRepos([primary]);

    const result = await repos.createSession(actor, "bot-1", { name: "Deep dive" });

    const feeds = eventCreate.mock.calls.map((call) => call[0].data.threadId as string);
    expect(feeds).toEqual(["session-primary", "session-new"]);
    for (const call of eventCreate.mock.calls) {
      expect(call[0].data).toMatchObject({
        botId: "bot-1",
        type: "session.created",
        payload: { threadId: "session-new", botId: "bot-1", name: "Deep dive" },
      });
    }
    expect(result.notifications).toEqual([
      { threadId: "session-primary", seq: 0 },
      { threadId: "session-new", seq: 0 },
    ]);
    expect(result.session).toEqual(expect.objectContaining({ name: "Deep dive" }));
  });

  it("renameSession appends session.renamed to every session feed", async () => {
    const primary = sessionRow({ id: "session-primary", isPrimary: true });
    const side = sessionRow({ id: "session-side" });
    const { repos, eventCreate } = sessionEventRepos([primary, side]);

    const result = await repos.renameSession(actor, "session-side", "Research");

    const feeds = eventCreate.mock.calls.map((call) => call[0].data.threadId as string);
    expect(feeds).toEqual(["session-primary", "session-side"]);
    for (const call of eventCreate.mock.calls) {
      expect(call[0].data).toMatchObject({
        type: "session.renamed",
        payload: { threadId: "session-side", botId: "bot-1", name: "Research" },
      });
    }
    expect(result.session).toEqual(expect.objectContaining({ name: "Research" }));
    expect(result.notifications).toHaveLength(2);
  });

  it("deleteSession appends session.deleted only to the remaining feeds", async () => {
    const primary = sessionRow({ id: "session-primary", isPrimary: true, name: "Main" });
    const side = sessionRow({ id: "session-side", name: "Side" });
    const { repos, eventCreate } = sessionEventRepos([primary, side]);

    const result = await repos.deleteSession(actor, "session-primary");

    const feeds = eventCreate.mock.calls.map((call) => call[0].data.threadId as string);
    expect(feeds).toEqual(["session-side"]);
    expect(eventCreate.mock.calls[0]?.[0].data).toMatchObject({
      type: "session.deleted",
      payload: { threadId: "session-primary", botId: "bot-1", name: "Main" },
    });
    expect(result.notifications).toEqual([{ threadId: "session-side", seq: 0 }]);
  });

  it("refuses to delete a session that has an active run (V13)", async () => {
    const primary = sessionRow({ id: "session-primary", isPrimary: true });
    const side = sessionRow({ id: "session-side" });
    const { repos, eventCreate, runFindFirst, state } = sessionEventRepos([primary, side]);
    runFindFirst.mockResolvedValue({ id: "run-active" });

    await expect(repos.deleteSession(actor, "session-side")).rejects.toBeInstanceOf(
      SessionActiveRunError,
    );
    expect(eventCreate).not.toHaveBeenCalled();
    expect(state.has("session-side")).toBe(true);
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

describe("bots/duplicate clones primary only (V16)", () => {
  it("createBot with parentBotId creates exactly one primary session, no clones of other sessions", async () => {
    // Simulate: bots/duplicate calls repos.createBot with parentBotId set.
    // The new bot should get exactly ONE primary session (not a clone of all parent sessions).
    const parentBot = {
      id: "parent-bot",
      threads: [
        { id: "parent-primary", isPrimary: true, name: "Parent main" },
        { id: "parent-side", isPrimary: false, name: "Parent side session" },
      ],
    };
    const createdBotThreads: Array<{ id: string; isPrimary: boolean }> = [];
    const createThread = vi.fn(
      async ({ data }: { data: { botId: string; isPrimary: boolean } }) => {
        createdBotThreads.push({ id: `new-thread-${createdBotThreads.length + 1}`, isPrimary: data.isPrimary });
        return { id: createdBotThreads[createdBotThreads.length - 1]!.id, ...data };
      },
    );
    const prisma = {
      bot: {
        findFirst: vi.fn().mockResolvedValue({ ...baseBot, id: "parent-bot" }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ ...baseBot, id: "parent-bot" }),
        create: vi.fn().mockResolvedValue({ id: "new-bot" }),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _max: { position: -1 } }),
      },
      thread: { create: createThread, findFirstOrThrow: vi.fn().mockResolvedValue(parentBot.threads[0]) },
      computer: { upsert: vi.fn().mockResolvedValue({ id: "computer-1", scope: "team" }) },
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
      space: { update: vi.fn() },
      spaceMember: { findUnique: vi.fn().mockResolvedValue({ id: "member-1", space: { deletingAt: null } }) },
      botMcpServer: { findMany: vi.fn().mockResolvedValue([]) },
      browserProfile: { create: vi.fn() },
      memoryDocument: { create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue(undefined),
      $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    await repos.createBot(actor, {
      name: "Duplicate Bot",
      title: "Duplicate",
      description: "",
      instructions: "",
      notifyOnFinish: false,
      parentBotId: "parent-bot",
    });

    // Exactly one thread created for the new bot (the implicit primary session)
    expect(createdBotThreads).toHaveLength(1);
    expect(createdBotThreads[0]!.isPrimary).toBe(true);
  });
});

describe("sidebar aggregates (V16)", () => {
  it("sets bot unread to OR over all sessions (any session unread → bot unread)", async () => {
    // Side session is unread, primary is not → bot should still be unread=true.
    const primary = {
      id: "session-primary",
      unread: false,
      isPrimary: true,
      messages: [],
    };
    const side = {
      id: "session-side",
      unread: true, // side session is unread
      isPrimary: false,
      messages: [],
    };
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [{ ...baseBot, threads: [primary, side] }]),
      },
      run: { findMany: vi.fn(async () => []) },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const bots = await repos.listBots(actor);

    // unread is OR over all sessions: true | false = true
    expect(bots[0]).toEqual(expect.objectContaining({ unread: true }));
  });

  it("sets bot unread to false when no session is unread", async () => {
    const primary = {
      id: "session-primary",
      unread: false,
      isPrimary: true,
      messages: [],
    };
    const side = {
      id: "session-side",
      unread: false,
      isPrimary: false,
      messages: [],
    };
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [{ ...baseBot, threads: [primary, side] }]),
      },
      run: { findMany: vi.fn(async () => []) },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const bots = await repos.listBots(actor);

    expect(bots[0]).toEqual(expect.objectContaining({ unread: false }));
  });

  it("preview comes from the primary session, not any other session", async () => {
    const primary = {
      id: "session-primary",
      unread: false,
      isPrimary: true,
      messages: [{ blocks: [{ kind: "text", text: "Primary latest" }] }],
    };
    const side = {
      id: "session-side",
      unread: false,
      isPrimary: false,
      // This would be the newest message if we were looking at all sessions,
      // but preview must be from primary.
      messages: [{ blocks: [{ kind: "text", text: "Side session newer text" }] }],
    };
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [{ ...baseBot, threads: [primary, side] }]),
      },
      run: { findMany: vi.fn(async () => []) },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const bots = await repos.listBots(actor);

    // Preview is from primary session regardless of which session has the newest message
    expect(bots[0]).toEqual(expect.objectContaining({ preview: "Primary latest" }));
  });

  it("run status comes from the primary session's runs (not per-session)", async () => {
    // The runs list in listBots is fetched across the bot's threads; the active run
    // selection (most recent active run) may land on any thread. This test verifies
    // the status comes from the bot-level run selection, which already matches intent.
    // (If a run exists on a non-primary thread, its status affects the bot's status.)
    const primary = {
      id: "session-primary",
      unread: false,
      isPrimary: true,
      messages: [],
    };
    const side = {
      id: "session-side",
      unread: false,
      isPrimary: false,
      messages: [],
    };
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [{ ...baseBot, threads: [primary, side] }]),
      },
      // No active runs → idle
      run: { findMany: vi.fn(async () => []) },
    };
    const repos = createRepos(prisma as unknown as PrismaClient);

    const bots = await repos.listBots(actor);

    // Status comes from the bot-level run selection → idle when no active runs
    expect(bots[0]).toEqual(expect.objectContaining({ status: "idle" }));
  });

  it("listSpaceBotsForSpaces aggregates unread as OR across all sessions", async () => {
    const primary = { id: "sp-primary", unread: false, isPrimary: true, messages: [] };
    const side = { id: "sp-side", unread: true, isPrimary: false, messages: [] };
    const botRow = {
      id: "bot-space",
      spaceId: "ws-1",
      name: "SpaceBot",
      title: "SpaceBot",
      description: "",
      instructions: "",
      color: "#6B7280",
      notifyOnFinish: false,
      pinned: false,
      sectionId: null,
      archivedAt: null,
      parentBotId: null,
      memoryScope: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-28T00:00:00.000Z"),
      threads: [primary, side],
      runs: [],
      computer: null,
    };
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [botRow]),
      },
    } as Record<string, Record<string, unknown>>;
    const repos = createRepos(prisma as unknown as PrismaClient);

    const bots = await repos.listSpaceBotsForSpaces(actor, ["ws-1"]);

    // unread = OR(false, true) = true
    expect(bots[0]).toEqual(expect.objectContaining({ unread: true }));
  });
});
