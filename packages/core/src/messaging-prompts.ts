import type { MessageBlock } from "@rakazo/contracts";

/** Instruction-stack note for bots whose owner has a messaging identity. */
export function messagingDmSurfaceNote(): string {
  return [
    "Chat surface: the owner also reaches you over a messaging app (iMessage/SMS, Slack, WhatsApp, or similar).",
    "That conversation and this one are the same thread; anything you reply here is mirrored to their chat.",
    "Keep replies concise. They arrive as chat messages.",
  ].join(" ");
}

/**
 * Live messaging connectivity, injected every run so the model states the
 * database's truth instead of guessing from stale memory ("Telegram is not
 * connected" hallucinations). Handles are validated — they are interpolated
 * into prompts.
 */
export function messagingLiveStatusNote(status: {
  linked: boolean;
  provider: string | null;
  telegramUsername: string | null;
}): string {
  const handle =
    status.telegramUsername && /^[A-Za-z0-9_]{3,32}$/.test(status.telegramUsername)
      ? ` (@${status.telegramUsername})`
      : "";
  if (status.linked && status.provider === "telegram") {
    return [
      `Live connection status (as of this run): the owner's Telegram line is connected${handle}.`,
      "Messages they send there reach you in this thread and your replies are delivered back — never claim Telegram is disconnected.",
    ].join(" ");
  }
  if (status.linked && status.provider) {
    return [
      `Live connection status (as of this run): the owner's messaging line is connected via ${status.provider}.`,
      "Messages they send there reach you in this thread and your replies are delivered back — never claim it is disconnected.",
    ].join(" ");
  }
  if (handle) {
    return `Live connection status (as of this run): the owner has a personal Telegram bot ${handle} connected to the deployment, but this bot's own messaging line is not linked yet.`;
  }
  return "Live connection status (as of this run): no messaging line is linked for this bot — never claim that Telegram or another messaging app is connected.";
}

/** Hard privacy rules for bots posting into shared group channels. */
export function messagingChannelPrivacyBlock(): string {
  return [
    "You are posting to a group chat with multiple people through the deployment's shared messaging line.",
    "Never reveal or share the owner's personal information, memory contents, scratchpad, or 1:1 conversation contents in the group.",
    'Your posts are publicly attributed to the owner ("<name>\'s agent: …").',
    "Reply only when you add value to the group; otherwise finish silently without posting.",
  ].join("\n");
}

export function messagingChannelId(sourceBlocks: MessageBlock[] | undefined): string | undefined {
  return sourceBlocks?.find((block) => block.kind === "channel_message")?.channelId;
}

/** Channel runs are messaging runs whose waking message came from a channel. */
export function isMessagingChannelRun(
  trigger: string,
  sourceBlocks: MessageBlock[] | undefined,
): boolean {
  return trigger === "messaging" && Boolean(messagingChannelId(sourceBlocks));
}

/**
 * Group names and owner names are attacker-controlled text interpolated
 * into prompts and DMs; strip framing characters before they get near one.
 */
export function sanitizeMessagingLabel(value: string): string {
  return value
    .replace(/[\r\n"[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}
