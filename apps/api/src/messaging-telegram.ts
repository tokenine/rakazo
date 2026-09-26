/**
 * Telegram Bot API helpers for the IM Channels settings surface. The bot
 * token comes from the deployment's TELEGRAM_BOT_TOKEN env (the messaging
 * platform mounts from the same value), so these helpers run server-side only.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

export type TelegramWebhookStatus = {
  configured: boolean;
  webhookUrl: string | null;
  lastErrorMessage: string | null;
  pendingUpdateCount: number;
};

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

async function telegramCall<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
): Promise<TelegramResponse<T>> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    return { ok: false, description: `Telegram API HTTP ${response.status}` };
  }
  return (await response.json()) as TelegramResponse<T>;
}

export async function telegramWebhookStatus(token: string): Promise<TelegramWebhookStatus> {
  const response = await telegramCall<{
    url: string;
    last_error_message?: string;
    pending_update_count: number;
  }>(token, "getWebhookInfo");
  if (!response.ok || !response.result) {
    throw new Error(response.description ?? "getWebhookInfo failed");
  }
  return {
    configured: true,
    webhookUrl: response.result.url || null,
    lastErrorMessage: response.result.last_error_message ?? null,
    pendingUpdateCount: response.result.pending_update_count ?? 0,
  };
}

export async function telegramSetWebhook(
  token: string,
  url: string,
  secretToken: string,
): Promise<void> {
  const response = await telegramCall<true>(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "edited_message", "callback_query"],
    drop_pending_updates: false,
  });
  if (!response.ok) {
    throw new Error(response.description ?? "setWebhook failed");
  }
}
