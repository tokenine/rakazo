# Proof Pack — S3 · 260f6f0a

## Diff stat
```
 apps/mobile/app/bot/[botId]/sessions.tsx | 419 +++++++++++++++++++++++++++++++
 apps/mobile/app/index.tsx                |   4 +-
 apps/mobile/app/thread.tsx               |  15 +-
 apps/mobile/lib/locales/ru.ts            |  21 ++
 apps/mobile/lib/locales/zh.ts            |  21 ++
 5 files changed, 475 insertions(+), 5 deletions(-)
```

## Mobile test suite
```
 RUN  v4.1.11 /Users/poom-work/rakazo
 Test Files  31 passed (31)
      Tests  275 passed (275)
   Duration  2.11s
```

## Mobile typecheck
```
> expo install --check && tsc --noEmit -p tsconfig.json
Dependencies are up to date
[tsc --noEmit passed with no errors]
```

## Contracts typecheck
```
[no output — passed]
```

## Key implementation facts (extracted from source)

### sessions.tsx line 41 — RPC call
```ts
const result = await rpc<BotSession[]>("threads/listSessions", { botId }, { signal: ctrl.signal });
```

### sessions.tsx line 81-85 — handleSelectSession
```ts
router.push({
  pathname: "/thread",
  params: { botId, threadId: session.id },
});
```

### thread.tsx line 236-237 — param extraction
```ts
const { botId, groupId, name, messageId, threadId } = useLocalSearchParams<{
  botId?: string;
  groupId?: string;
  name?: string;
  messageId?: string;
  threadId?: string;
}>();
```

### thread.tsx line 689-692 — refresh with threadId
```ts
targetGroupId
  ? { groupId: targetGroupId }
  : { botId: targetBotId!, ...(targetThreadId ? { threadId: targetThreadId } : {}) },
```

### thread.tsx line 974-978 — useEffect for threadId
```ts
useEffect(() => {
  if (!threadId || !botId) return;
  void refresh(threadId).catch(() => undefined);
}, [botId, threadId]);
```

### SESSION_LIST_ORDER (thread-listing.ts)
```ts
export const SESSION_LIST_ORDER: Prisma.ThreadOrderByWithRelationInput[] = [
  { isPrimary: "desc" },
  { lastMessageAt: { sort: "desc", nulls: "last" } },
  { createdAt: "desc" },
];
```

### BotSessionSchema fields (domain.ts)
```ts
export const BotSessionSchema = z.object({
  id: Id,
  botId: Id,
  name: z.string().nullable(),
  isPrimary: z.boolean(),
  unread: z.boolean(),
  preview: z.string(),
  createdAt: z.string(),
  lastMessageAt: z.string().nullable(),
});
```

### No hardcoded hex — grep result
```
[no matches found]
```

### index.tsx BotRow navigation (line 638-643)
```ts
router.push({
  pathname: "/bot/[botId]/sessions",
  params: { botId: item.bot.id },
}),
```
