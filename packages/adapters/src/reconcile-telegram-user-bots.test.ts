import type { MessagingSurface } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { reconcileTelegramUserBots } from "./messaging-platforms.js";

function fakeSurface(liveProviders: string[]) {
  const registered: string[] = [];
  const removed: string[] = [];
  const surface = {
    platforms: vi.fn(() =>
      liveProviders.map((provider) => ({
        provider,
        capabilities: { direct: true, groups: false, typing: false },
      })),
    ),
    registerUserPlatform: vi.fn((platform: { provider: string }) => {
      registered.push(platform.provider);
      liveProviders.push(platform.provider);
    }),
    unregisterUserPlatform: vi.fn((provider: string) => {
      removed.push(provider);
      const index = liveProviders.indexOf(provider);
      if (index >= 0) liveProviders.splice(index, 1);
    }),
  } as unknown as MessagingSurface & {
    registered: string[];
    removed: string[];
  };
  return { surface, registered, removed };
}

function fakePrisma(
  rows: Array<{ id: string; userId: string; tokenCiphertext: string; webhookSecret: string }>,
) {
  return {
    messagingTelegramBot: { findMany: vi.fn(async () => rows) },
  } as never;
}

// The real adapter constructor validates the token shape (id:secret).
const secrets = { load: vi.fn(() => "123456:test-token") } as never;

describe("reconcileTelegramUserBots", () => {
  it("registers every stored row onto an empty surface", async () => {
    const { surface, registered } = fakeSurface([]);
    const result = await reconcileTelegramUserBots({
      prisma: fakePrisma([
        { id: "row-1", userId: "u1", tokenCiphertext: "ct1", webhookSecret: "s1" },
        { id: "row-2", userId: "u1", tokenCiphertext: "ct2", webhookSecret: "s2" },
      ]),
      secrets,
      messaging: surface,
    });

    expect(result).toEqual({ registered: 2, removed: 0 });
    expect(registered).toEqual(["telegram-urow-1", "telegram-urow-2"]);
  });

  it("skips live adapters and registers only rows added after boot", async () => {
    const { surface, registered } = fakeSurface(["telegram-urow-1"]);
    const result = await reconcileTelegramUserBots({
      prisma: fakePrisma([
        { id: "row-1", userId: "u1", tokenCiphertext: "ct1", webhookSecret: "s1" },
        { id: "row-2", userId: "u1", tokenCiphertext: "ct2", webhookSecret: "s2" },
      ]),
      secrets,
      messaging: surface,
    });

    expect(result).toEqual({ registered: 1, removed: 0 });
    expect(registered).toEqual(["telegram-urow-2"]);
  });

  it("drops adapters whose rows were deleted, leaving other providers alone", async () => {
    const { surface, removed } = fakeSurface(["telegram", "telegram-urow-gone", "telegram-urow-1"]);
    const result = await reconcileTelegramUserBots({
      prisma: fakePrisma([
        { id: "row-1", userId: "u1", tokenCiphertext: "ct1", webhookSecret: "s1" },
      ]),
      secrets,
      messaging: surface,
    });

    expect(result).toEqual({ registered: 0, removed: 1 });
    expect(removed).toEqual(["telegram-urow-gone"]);
  });
});
