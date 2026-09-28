# S3 QA Note — Mobile Session Screen (V15)

## V15 — Per-bot session list screen

**Requirement**: Device/manual: per-bot session list screen renders, create + switch work; thread.tsx opens the chosen session.

### CI Coverage

Offline CI (vitest) cannot capture native mobile UI rendering or user interaction flows. This is a repo rule for mobile UI: native-only screens (Expo Router screens with ActionSheetIOS, Alert.prompt, native navigation) are not exercised by jest/vitest test suites running in Node.js without a device or emulator.

### Manual Verification Steps

To verify V15 on a physical iOS/Android device or simulator:

1. **Build**: `pnpm --filter @rakazo/mobile prebuild` then `npx expo run:ios` (or `run:android`).
2. **Inbox → Bot row tap**: From the inbox list, tap any bot row. Should navigate to `/bot/[botId]/sessions`.
3. **Session list renders**: The screen shows all sessions for that bot, ordered by last activity. Primary session is marked with a "PRIMARY" badge. Sessions with unread messages show an unread dot.
4. **Switch session**: Tap any session row. Should navigate to `/thread?botId=…&threadId=…` and load that session's message history.
5. **Create session**: Tap "+ New". Alert.prompt appears. Enter a name, confirm. New session appears at the top of the list.
6. **Rename session**: Long-press any session row (or tap on iOS to show ActionSheetIOS). Choose "Rename". Enter new name, confirm. Name updates in the list.
7. **Delete session**: Long-press any session row → ActionSheetIOS → "Delete session". Confirmation alert appears. Confirm → session removed from list. Server guard prevents deleting the last remaining session.
8. **Back navigation**: Back button returns to the inbox.
9. **Thread with threadId**: Verify that opening a session directly from a deep link (e.g. `/thread?botId=abc&threadId=xyz`) loads the correct session without needing to navigate through the sessions list.
10. **Error states**: With the app offline, attempting to load sessions shows an error with a "Retry" button. Creating/renaming/deleting while offline surfaces a native alert with the error message.

### Acceptance

- V15: **MANUAL VERIFICATION REQUIRED** — native UI cannot be captured by offline CI.
- T16 (degradation note): This note constitutes the recorded degradation for V15 per the repo rule.
