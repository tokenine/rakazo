import {
  createTelegramAdapter,
  type TelegramAdapter,
  type TelegramAdapterConfig,
} from "@chat-adapter/telegram";

const TELEGRAM_PREFIX = "telegram:";

/**
 * The upstream telegram adapter hardcodes its identity — `name = "telegram"`
 * and thread ids `telegram:<chatId>` — while the Chat SDK routes everything
 * (webhook registration, inbound provider derivation, outbound adapter
 * selection, per-thread conversation locks) on that prefix. Hosting N user
 * bots therefore needs one adapter instance per bot whose ids carry a unique
 * key (`telegram-u<rowId>:<chatId>`), which the upstream config has no option
 * for. This factory shadows the identity-bearing methods at the instance
 * level: ids crossing the Chat SDK boundary carry the key, ids crossing the
 * Bot API boundary stay plain `telegram:`. Safe because every internal call
 * site dispatches through `this.` (encodeThreadId ×17, decodeThreadId ×2,
 * resolveThreadId ×10 upstream) and the rewritten methods stay idempotent
 * under double application.
 */
export function createKeyedTelegramAdapter(
  key: string,
  config: TelegramAdapterConfig = {},
): TelegramAdapter {
  const adapter = createTelegramAdapter(config);

  /** `telegram:X[:Y]` → `${key}:X[:Y]` */
  const rewrite = (threadId: string): string =>
    threadId.startsWith(TELEGRAM_PREFIX)
      ? `${key}:${threadId.slice(TELEGRAM_PREFIX.length)}`
      : threadId;
  /** `${key}:X[:Y]` → `telegram:X[:Y]`; plain and already-restored ids pass through. */
  const restore = (threadId: string): string =>
    threadId.startsWith(`${key}:`) ? `telegram:${threadId.slice(key.length + 1)}` : threadId;

  (adapter as { name: string }).name = key;

  const encodeThreadId = adapter.encodeThreadId.bind(adapter);
  adapter.encodeThreadId = (platformData) => rewrite(encodeThreadId(platformData));

  const decodeThreadId = adapter.decodeThreadId.bind(adapter);
  adapter.decodeThreadId = (threadId) => decodeThreadId(restore(threadId));

  const channelIdFromThreadId = adapter.channelIdFromThreadId.bind(adapter);
  // Its non-business branch returns a literal `telegram:${chatId}` instead of
  // going through encodeThreadId, so rewrite the output too.
  adapter.channelIdFromThreadId = (threadId) => rewrite(channelIdFromThreadId(restore(threadId)));

  const openDM = adapter.openDM.bind(adapter);
  adapter.openDM = async (userId) => rewrite(await openDM(userId));

  // Protected upstream; it feeds decodeThreadId (already restored above), so
  // restoring the input here is what makes raw outbound ids (`post`, typing)
  // resolve instead of being treated as a bare chat_id.
  const internals = adapter as unknown as {
    resolveThreadId: (value: string) => unknown;
  };
  const resolveThreadId = internals.resolveThreadId.bind(adapter);
  internals.resolveThreadId = (threadId) => resolveThreadId(restore(threadId));

  return adapter;
}

/** The per-row provider key for a user telegram bot row. */
export function telegramUserProvider(rowId: string): string {
  return `telegram-u${rowId}`;
}

/** The row id embedded in a `telegram-u<rowId>` provider, or null. */
export function rowIdOfTelegramUserProvider(provider: string): string | null {
  return provider.startsWith("telegram-u") ? provider.slice("telegram-u".length) || null : null;
}
