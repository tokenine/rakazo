# QA Report — Feature 002: Inspiration Hub (Final)
**Candidate:** `ba03becd`
**Commits verified:** `63495e05` (test fix) → `20800786` (HubPage gating) → `8737203a` (shell hijack) → `697a638f` (DTO return fix)
**QA Worktree:** `ss/bug/002-hubfix` at `/Users/poom-work/.super-speckit-worktrees/ss/bug/002-hubfix`
**Date:** 2026-09-28
**Checker:** Checker002 (independent)

---

## Full Diff Audit: 63495e05..697a638f (4 files, correct scope)

| File | Commit | Change |
|------|--------|--------|
| `HubPage.tsx` | 20800786 | `bots.length > 0` guard replaces `hasContent &&`; Gallery unconditional |
| `router.ts` | 20800786 | `createFromExpert`: re-fetch via `getBot` |
| `router.ts` | 697a638f | **Revert getBot re-fetch**; return `bot` (mapBot-mapped DTO) directly |
| `Shell.tsx` | 8737203a | 3× `!hubEntry` guards on refreshBots, bootstrap, open-first-bot |
| `hub.spec.ts` | 63495e05 | Test 1: `toBeVisible()`; Test 3: 2-segment URL regex |

### Final diff 8737203a..697a638f (1 file exactly)
```diff
-        const created = await repos
+        const bot = await repos
-        return await repos.getBot(context.actor, created.id);
+        // (MCP/skills loops unchanged)
+        return bot;
```
The `getBot` re-fetch was removed. `createBot` → `mapBot(bot)` returns the mapped DTO with `threadId` correctly populated through the mapper's own logic (not the raw row re-fetch).

---

## E2E Results at 697a638f (fresh postgres:16-alpine, own API on :3100)

**Environment recipe:**
- `docker run -d --name pg-final -e POSTGRES_PASSWORD=e2e -p 54350:5432 postgres:16-alpine`
- `DATABASE_URL=postgresql://postgres:e2e@localhost:54350/postgres`
- `NODE_ENV=test EMAIL_EMULATOR=true SIGNUPS_ENABLED=true SIGNUP_ALLOWLIST=""`
- API: `pnpm start` (listens on :3100)
- Web: `playwright test e2e/hub.spec.ts`

**Run 1:** ✅ ✅ ✅ (24.5s)
**Run 2:** ✅ ✅ ✅ (22.2s)

| Test | Result | Details |
|------|--------|---------|
| 1: empty deployment → guided first actions | ✅ | Gallery + Activity + First-actions visible on /app/hub for signupOnly user |
| 2: active deployment → bot previews | ✅ | Bot preview cards visible |
| 3: Make similar → navigates to thread | ✅ | Navigated to `/app/{botId}/{threadId}` with composer visible |

---

## Findings Classification

### F-002-A: Gallery always visible — ✅ FIXED
**Classification:** Product gap (not a defect)

`hasContent=false` is unreachable — first bot is auto-created by `OnboardingPage.ensureFirstBot()` with `@@unique([spaceId, spawnKey])` before navigation to `/app`. The fix removes the `hasContent` guard from Activity zone gating, making Gallery unconditional.

**Evidence:** Test 1 passes — signupOnly user sees all three zones on `/app/hub`.

### F-002-B: threadId null in createFromExpert — ✅ FIXED
**Classification:** Product defect

`createFromExpert` called `mapBot(bot)` where `bot.threads` was the raw Prisma array (unpopulated). The fix at 697a638f returns the `mapBot`-mapped DTO directly from `createBot` — the mapper itself correctly computes `threadId` from the created bot's primary session thread.

**Evidence:** Test 3 passes — navigation to `/app/{botId}/{threadId}` (2-segment URL) proves `threadId` is populated.

### Shell Hijack (8737203a): ✅ FIXED
Three Shell effects forced `/app/hub` to redirect: (1) refreshBots redirect at `:892`, (2) bootstrap redirect at `:1133`, (3) open-first-bot navigation at `:1151`. Fix adds `!hubEntry &&` guard to all three. Non-hub routes (`/app`, `/app/:botId`, `/app/:botId/:threadId`) are unaffected.

---

## Gate Summary

| Gate | Result |
|------|--------|
| Contracts unit | ✅ 59/59 |
| DB offline | ✅ 131/8 |
| E2E | ✅ 3/3 × 2 (deterministic, fresh DB + own API) |
| Diff audit | ✅ 4 files, correct scope |
| Product fixes | ✅ F-002-A FIXED, F-002-B FIXED, Shell hijack FIXED |

---

## Final Gate Verdict

**PASS ✅**

All acceptance criteria met:
1. ✅ Empty deployment user sees Gallery + Activity + First-actions on `/app/hub` (F-002-A)
2. ✅ Make similar navigates to `/app/{botId}/{threadId}` with composer (F-002-B)
3. ✅ Shell does not hijack `/app/hub` navigation (8737203a guards)
4. ✅ Contracts, DB suites clean
5. ✅ E2E 3/3 × 2 with fresh DB and isolated API process
