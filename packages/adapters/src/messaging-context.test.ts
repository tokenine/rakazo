import { describe, expect, it, vi } from "vitest";
import { createMessagingContextLoader } from "./messaging-context.js";

describe("createMessagingContextLoader", () => {
  it("reports an unlinked bot with a single identity query", () => {
    const findUnique = vi.fn(async () => null);
    const loader = createMessagingContextLoader({
      messagingIdentity: { findUnique },
      messagingTelegramBot: { findUnique: vi.fn() },
    } as never);

    expect(loader.dmStatus("bot-1", "user-1")).resolves.toEqual({
      linked: false,
      provider: null,
      telegramUsername: null,
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("reports the linked provider and the owner's telegram bot handle", async () => {
    const loader = createMessagingContextLoader({
      messagingIdentity: { findUnique: vi.fn(async () => ({ provider: "telegram" })) },
      messagingTelegramBot: { findUnique: vi.fn(async () => ({ username: "domedemo_bot" })) },
    } as never);

    await expect(loader.dmStatus("bot-1", "user-1")).resolves.toEqual({
      linked: true,
      provider: "telegram",
      telegramUsername: "domedemo_bot",
    });
  });

  it("omits the handle when the owner has no telegram bot row", async () => {
    const loader = createMessagingContextLoader({
      messagingIdentity: { findUnique: vi.fn(async () => ({ provider: "sendblue" })) },
      messagingTelegramBot: { findUnique: vi.fn(async () => null) },
    } as never);

    await expect(loader.dmStatus("bot-1", "user-1")).resolves.toEqual({
      linked: true,
      provider: "sendblue",
      telegramUsername: null,
    });
  });
});
