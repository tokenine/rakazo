import { describe, expect, it, vi } from "vitest";
import { createMessagingContextLoader } from "./messaging-context.js";

describe("createMessagingContextLoader", () => {
  it("reports an unlinked bot with a single identity query", () => {
    const findUnique = vi.fn(async () => null);
    const loader = createMessagingContextLoader({
      messagingIdentity: { findUnique },
      messagingTelegramBot: { findFirst: vi.fn() },
    } as never);

    expect(loader.dmStatus("bot-1", "user-1")).resolves.toEqual({
      linked: false,
      provider: null,
      telegramUsername: null,
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("reports the linked provider and that row's telegram bot handle", async () => {
    const findFirst = vi.fn(async ({ where }: { where: { userId: string; id?: string } }) =>
      where.id === "row-9" ? { username: "domedemo_bot" } : null,
    );
    const loader = createMessagingContextLoader({
      messagingIdentity: { findUnique: vi.fn(async () => ({ provider: "telegram-urow-9" })) },
      messagingTelegramBot: { findFirst },
    } as never);

    await expect(loader.dmStatus("bot-1", "user-1")).resolves.toEqual({
      linked: true,
      provider: "telegram-urow-9",
      telegramUsername: "domedemo_bot",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1", id: "row-9" }),
      }),
    );
  });

  it("falls back to the user's rows for legacy telegram providers", async () => {
    const findFirst = vi.fn(async () => ({ username: "legacy_bot" }));
    const loader = createMessagingContextLoader({
      messagingIdentity: { findUnique: vi.fn(async () => ({ provider: "telegram" })) },
      messagingTelegramBot: { findFirst },
    } as never);

    await expect(loader.dmStatus("bot-1", "user-1")).resolves.toEqual({
      linked: true,
      provider: "telegram",
      telegramUsername: "legacy_bot",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ id: expect.anything() }) }),
    );
  });

  it("omits the handle when the owner has no telegram bot row", async () => {
    const loader = createMessagingContextLoader({
      messagingIdentity: { findUnique: vi.fn(async () => ({ provider: "sendblue" })) },
      messagingTelegramBot: { findFirst: vi.fn(async () => null) },
    } as never);

    await expect(loader.dmStatus("bot-1", "user-1")).resolves.toEqual({
      linked: true,
      provider: "sendblue",
      telegramUsername: null,
    });
  });
});
