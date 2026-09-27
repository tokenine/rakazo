/**
 * Per-user Telegram bots: each account can register its own BotFather tokens
 * — many per account, and many accounts side by side. Every row registers
 * under its own `telegram-u<rowId>` provider key (see telegram-keyed-adapter),
 * so connections coexist; the row id in the webhook URL selects the adapter.
 */
import type { MessagingSurface } from "@rakazo/adapter-kit";
import type { EncryptedSecretStore } from "@rakazo/adapters";
import { createUserTelegramPlatform, telegramUserProvider } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";

export type TelegramUserBotRow = {
  id: string;
  userId: string;
  username: string;
  tokenCiphertext: string;
  webhookSecret: string;
};

type TelegramUserDeps = {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  messaging: MessagingSurface;
};

/** Decrypt the stored token and register (or re-register) the bot's adapter. */
export async function registerTelegramUserBot(
  deps: TelegramUserDeps,
  row: TelegramUserBotRow,
): Promise<void> {
  const token = deps.secrets.load(row.tokenCiphertext, `tgbot-${row.userId}`);
  deps.messaging.registerUserPlatform?.(
    createUserTelegramPlatform({
      key: telegramUserProvider(row.id),
      botToken: token,
      webhookSecret: row.webhookSecret,
    }),
  );
}

/**
 * Inbound webhooks for user bots. Verification (the per-bot secret header)
 * happens inside the adapter via surface.handleWebhook; unknown bot ids 404
 * without revealing which ids exist.
 */
export function mountUserTelegramWebhookRoute(app: Hono, deps: TelegramUserDeps): void {
  app.all("/api/v1/messaging/webhook/telegram-user/:botId", async (c) => {
    const row = await deps.prisma.messagingTelegramBot.findUnique({
      where: { id: c.req.param("botId") },
    });
    if (!row) return c.json({ error: "Unknown bot" }, 404);
    const response = deps.messaging.handleWebhook(telegramUserProvider(row.id), c.req.raw);
    if (!response) return c.json({ error: "Bot not ready" }, 503);
    return response;
  });
}
