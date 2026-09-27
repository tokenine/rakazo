/**
 * Per-user Telegram bots: each account can register its own BotFather token.
 * The telegram adapter hardcodes its thread-id prefix ("telegram:<chatId>"),
 * so the surface hosts a single "telegram" slot; the registered user bot owns
 * it (a deployment-env bot keeps priority). Connecting replaces the previous
 * occupant — documented single-slot behaviour for now.
 */
import type { MessagingSurface } from "@rakazo/adapter-kit";
import type { EncryptedSecretStore } from "@rakazo/adapters";
import { createUserTelegramPlatform, TELEGRAM_SLOT_PROVIDER } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";

export { TELEGRAM_SLOT_PROVIDER };

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
  const platform = createUserTelegramPlatform({
    key: TELEGRAM_SLOT_PROVIDER,
    botToken: token,
    webhookSecret: row.webhookSecret,
  });
  deps.messaging.unregisterUserPlatform?.(TELEGRAM_SLOT_PROVIDER);
  deps.messaging.registerUserPlatform?.(platform);
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
    const response = deps.messaging.handleWebhook(TELEGRAM_SLOT_PROVIDER, c.req.raw);
    if (!response) return c.json({ error: "Bot not ready" }, 503);
    return response;
  });
}
