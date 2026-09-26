/**
 * Per-user Telegram bots: each account can register its own BotFather token.
 * The API process hosts one webhook adapter per registered bot under a unique
 * provider key ("telegram-u<rowId>") — thread ids carry that prefix, so
 * outbound routing and identity namespaces never mix between bots.
 */
import type { MessagingSurface } from "@rakazo/adapter-kit";
import type { EncryptedSecretStore } from "@rakazo/adapters";
import { createUserTelegramPlatform } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";

type TelegramUserBotRow = {
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

export function userTelegramProviderKey(row: Pick<TelegramUserBotRow, "id">): string {
  return `telegram-u${row.id}`;
}

/** Decrypt the stored token and register (or re-register) the bot's adapter. */
export async function registerTelegramUserBot(
  deps: TelegramUserDeps,
  row: TelegramUserBotRow,
): Promise<void> {
  const token = deps.secrets.load(row.tokenCiphertext, `tgbot-${row.userId}`);
  const provider = userTelegramProviderKey(row);
  const platform = createUserTelegramPlatform({
    key: provider,
    botToken: token,
    webhookSecret: row.webhookSecret,
  });
  deps.messaging.unregisterUserPlatform?.(provider);
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
    const response = deps.messaging.handleWebhook(userTelegramProviderKey(row), c.req.raw);
    if (!response) return c.json({ error: "Bot not ready" }, 503);
    return response;
  });
}
