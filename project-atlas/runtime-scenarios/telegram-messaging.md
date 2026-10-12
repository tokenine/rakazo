# Runtime scenario: Telegram inbound → run → outbound reply

Status: verified from code; live-verified per docs/HANDOFF.md §4 (2026-09-27).

```text
Telegram → webhook POST /api/v1/messaging/webhook/telegram-user/<rowId>  (per user bot row)
  │ secret header verified inside the keyed adapter (telegram-keyed-adapter.ts)
  ▼
createMessagingInboundHandler                    apps/api/src/messaging-inbound.ts
  │ resolve identity by provider+address in messaging_identities
  │   - unknown sender + link code → bind; provisioning per signup policy
  │   - owner commands (YES/NO/LEAVE) → approval answers
  │   - media: download via adapter closure → createOwnedArtifact (≤25 MB, any mime,
  │     ≤4 attachments) → image blocks for vision / file blocks otherwise
  ▼
events.sendUserMessage → task + run (queued)
  ▼
worker: run_continue → executor.continueRun      (same loop as agent-run.md)
  │ run instructions include messagingLiveStatusNote(...) built from DB truth
  │ (anti-hallucination: bot always knows its Telegram connection state)
  ▼
assistant message + outbox rows (kind text/image, artifactId)
  ▼
worker: messaging.deliver → deliverMessagingOutbound   messaging-delivery.ts
  │ resolve sending identity → provider embeds row id (telegram-u<rowId>)
  │ decrypt bot token (record tgbot-<userId>; AAD shared per user)
  │ text → sendMessage mirror; images/docs → multipart sendPhoto/sendDocument (≤50 MB)
  │ caps: 140 consecutive DM outbound, 5 attempts, status tracked on rows
  ▼
Telegram user receives reply
```

Legacy/edge paths: env deployment bot uses provider `telegram` (plain thread ids);
group outbox rows route through the env bot; `messaging_identities.botId @unique` means
each chat line links to exactly one bot.
