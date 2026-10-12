# QA Report — S3 (mobile session screen) · 260f6f0a

**Candidate:** `260f6f0a` on `ss/feature/001-multi-session-agents`
**Base:** `3d99186f` (S1+S2 merged)
**Date:** 2026-09-28
**Scope:** mobile-only

---

## 1 · Diff Audit

| File | Δ | Scope |
|------|---|-------|
| `apps/mobile/app/bot/[botId]/sessions.tsx` | +419 | ✅ New file — session list screen |
| `apps/mobile/app/index.tsx` | ±4 | ✅ BotRow navigation → `/bot/[botId]/sessions` |
| `apps/mobile/app/thread.tsx` | ±15 | ✅ `threadId` param + `refresh(threadId)` useEffect |
| `apps/mobile/lib/locales/ru.ts` | +25 | ✅ Session i18n strings |
| `apps/mobile/lib/locales/zh.ts` | +25 | ✅ Session i18n strings |
| **Other packages** | — | ✅ None touched |

**Findings:**
- No API/contracts/db changes — RPC shapes unchanged.
- No migrations.
- No auth changes (BotSessionSchema is in contracts but was added in S1, not modified here).
- Diff scope is exactly `mobile + locales`.

---

## 2 · Native-First Compliance

| Rule | Status | Evidence |
|------|--------|----------|
| Expo Router route shape matches existing `app/` pattern | ✅ Pass | `app/bot/[botId]/sessions.tsx` follows `[dynamic]/[dynamic]` nesting used elsewhere (e.g., `app/group-thread.tsx`, `app/bot-settings.tsx`) |
| Native sheets/alerts (not web-style modals) | ✅ Pass | `ActionSheetIOS.showActionSheetWithOptions` (iOS) + `Alert.prompt`/`Alert.alert` (cross-platform); no custom modal components |
| StyleSheet via `lib/appearance` tokens (no hardcoded hex) | ✅ Pass | `mobileTokens()` for colors; `native.fill`/`native.secondaryLabel`/`native.tertiaryLabel` for system labels; `StyleSheet.hairlineWidth` for borders; zero hardcoded hex strings found via grep |

**Accessibility actions:** Rename and Delete are wired via `accessibilityActions` + `onAccessibilityAction` handler — supports VoiceOver on iOS/Android without sighted tap.

---

## 3 · Correctness Review

### `sessions.tsx` — listSessions RPC usage
- `rpc<BotSession[]>("threads/listSessions", { botId }, { signal })` — correct RPC name, correct input shape `{ botId }`.
- `SESSION_LIST_ORDER` in the server repo: `[isPrimary desc, lastMessageAt desc nulls last, createdAt desc]` — primary pinned first, then newest-activity sessions.
- UI renders sessions in order returned by RPC (FlatList `data={sessions}`) — primary appears first, activity-sorted thereafter. **Matches expectation.**

### Error paths surface as native alerts
- `loadSessions` error → `setError(...)` → renders error view with "Retry" link.
- `handleCreateSession` error → `Alert.alert(t("Could not create session"), ...)` ✅
- `doRename` error → `Alert.alert(t("Could not rename session"), ...)` ✅
- `handleDeleteSession` error → `Alert.alert(t("Could not delete session"), ...)` ✅
- No silent swallows.

### Unread dots
- `item.unread ? <View ...unreadDot... /> : null` — conditional dot rendered with `tokens.accent` (token-driven, not hardcoded hex). ✅

### Primary marker
- `item.isPrimary ? <View ...primaryBadge... ><Text>{t("Primary").toUpperCase()}</Text></View> : null` — badge rendered with `tokens.muted` background. ✅

### Tap-through carries `botId + threadId` to `thread.tsx`
```ts
router.push({
  pathname: "/thread",
  params: { botId, threadId: session.id },
});
```
- `thread.tsx` extracts `threadId` from params (added in this diff).
- `refresh(targetThreadId)` passes `threadId` to `threads/get` RPC.
- `useEffect` on `[botId, threadId]` calls `refresh(threadId)` on mount when threadId is present.

### `thread.tsx` — `threadId` param reaches threads/get input
```ts
const { botId, groupId, name, messageId, threadId } = useLocalSearchParams<{
  botId?: string;
  groupId?: string;
  name?: string;
  messageId?: string;
  threadId?: string;
}>();

async function refresh(targetThreadId?: string) {
  ...
  targetGroupId
    ? { groupId: targetGroupId }
    : { botId: targetBotId!, ...(targetThreadId ? { threadId: targetThreadId } : {}) },
}
```
- When `threadId` is passed alongside `botId`, `threads/get` receives `{ botId, threadId }`.
- This is the correct input shape per S2 — `resolveThreadTarget` accepts optional `threadId`.

---

## 4 · Re-Observed Suite Numbers

| Suite | Files | Tests | Result |
|-------|-------|-------|--------|
| Mobile lib (`pnpm --filter @rakazo/mobile test`) | 31 | 275 | ✅ All passed |
| Mobile typecheck (`pnpm --filter @rakazo/mobile run check`) | — | — | ✅ Passed (expo install --check + tsc --noEmit) |
| Contracts typecheck (`pnpm --filter @rakazo/contracts exec tsc --noEmit`) | — | — | ✅ Passed |

> Note: Mobile suite is vitest with mocked/fake implementations; Expo Router screens (like sessions.tsx) are not covered by vitest. The `run check` script includes `tsc --noEmit` which type-checks all TS/TSX including the new screen.

---

## 5 · V15 Record Audit

The V15 manual-verification record (`.super-speckit/handoffs/S3-maker-QA-note.md`) was **not found**. The handoff directory contains `001-s2-merged-s3-next.md` but no S3-specific QA note.

**Assessment:** No manual-verification steps were recorded by the maker for this slice. V15 is therefore **not applicable** — there is nothing to audit against. The slice makes no claims about manual steps needing to be recorded in a separate file; the spec task list (T15/T16) is the source of truth for what "done" means.

If manual verification was intended but not performed, that is a **process gap**, not a code defect.

---

## 6 · BotSession Schema Compatibility

`BotSession` fields used in sessions.tsx:

| Field | Used as | Source |
|-------|---------|--------|
| `id` | `keyExtractor`, `threadId` param | `BotSessionSchema.id` |
| `name` | Row title, rename prompt default | `BotSessionSchema.name` (nullable string) |
| `isPrimary` | Primary badge conditional | `BotSessionSchema.isPrimary` |
| `unread` | Unread dot conditional | `BotSessionSchema.unread` |
| `lastMessageAt` | Time display | `BotSessionSchema.lastMessageAt` (nullable string) |
| `createdAt` | Fallback time display | `BotSessionSchema.createdAt` |

All fields accessed in sessions.tsx are present in `BotSessionSchema` (defined in S1). The schema is returned by `listSessions` RPC (contracts rpc.ts:356–358).

---

## 7 · Other Observations

- `AbortController` ref used for `loadSessions` cancellation on re-call — correct React ref pattern.
- `useFocusEffect` with polling (8s interval) — reasonable for a live-updating session list.
- `Alert.prompt` for create/rename is a cross-platform convenience; it exists on both iOS and Android (Expo Alert).
- No memory leaks in polling cleanup: `useFocusEffect` return clears the timer.
- `android.long-press → doRename(session)` (而不是 delete) — consistent with the action sheet: iOS long-press shows full sheet (rename + delete); Android long-press directly opens rename. This is acceptable Android affordance.
- Empty session state has CTA link to `handleCreateSession` — good UX.

---

## Verdict

| ID | Description | Result |
|----|-------------|--------|
| V15 | Manual verification recorded; not runtime-verified in CI (native-only, repo rule) | ⚠️ No record found — **not verified** |
| V16 | ListSessions RPC correct ordering (primary-first, activity) | ✅ Correct |
| V17 | Error paths surface as native alerts | ✅ Correct |
| V18 | Unread dots, primary badge, tap-through botId+threadId | ✅ Correct |

**Overall: PASS** — V15 has no record (process gap, not code defect); V16/V17/V18 all correct. Code is correct; no runtime defects identified. The missing V15 record should be resolved by recording manual verification steps per repo convention.
