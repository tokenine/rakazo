import type { PrismaClient } from "@rakazo/db";

export interface MessagingSurfaceStatus {
  /** The bot owns a messaging identity — its owner's DM line is linked. */
  linked: boolean;
  /** Provider of the linked line (telegram, sendblue, slack, …); null when unlinked. */
  provider: string | null;
  /** Handle of the owner's personal Telegram bot row, when one exists. */
  telegramUsername: string | null;
}

import { rowIdOfTelegramUserProvider } from "./telegram-keyed-adapter.js";

/**
 * Executor dep answering live messaging-surface questions. One indexed query
 * when the bot is unlinked, two when it is linked — the same order the
 * boolean it replaced cost — and none when the messaging surface is absent.
 */
export function createMessagingContextLoader(prisma: PrismaClient) {
  return {
    dmStatus: async (botId: string, userId: string): Promise<MessagingSurfaceStatus> => {
      const identity = await prisma.messagingIdentity.findUnique({
        where: { botId },
        select: { provider: true },
      });
      if (!identity) return { linked: false, provider: null, telegramUsername: null };
      // A user may connect several telegram bots; the identity's provider key
      // (`telegram-u<rowId>`) names the one this bot is linked through.
      const rowId = rowIdOfTelegramUserProvider(identity.provider);
      const telegramBot = await prisma.messagingTelegramBot.findFirst({
        where: { userId, ...(rowId ? { id: rowId } : {}) },
        orderBy: { createdAt: "asc" },
        select: { username: true },
      });
      return {
        linked: true,
        provider: identity.provider,
        telegramUsername: telegramBot?.username ?? null,
      };
    },
  };
}
