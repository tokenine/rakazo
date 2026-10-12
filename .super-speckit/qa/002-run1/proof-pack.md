# Proof Pack — Feature 002: Inspiration Hub
**Candidate:** `ba03becd`

## Gate Evidence

### Contracts unit (59/59)
```
 RUN  v4.1.11
 Test Files  7 passed (7)
      Tests  59 passed (59)
```

### DB (131/8)
```
 Test Files  14 passed | 3 skipped (17)
      Tests  131 passed | 8 skipped (139)
```

### API (394/0)
```
 Test Files  30 passed (30)
      Tests  394 passed (394)
```

### Typecheck contracts/web
No output (clean).

### Typecheck api — pre-existing
Same 16 `implicit any` errors at `0a6a2aab` (baseline). Not introduced by `ba03becd`.

---

## E2E Evidence

### Test 2 screenshot (V1 active deployment — PASSING)
`apps/web/test-results/hub-hub-active-deployment-shows-bot-previews-on-app-hub-chromium/hub-active-v1.png`

### Test 1 failure screenshot
`apps/web/test-results/hub-hub-empty-deployment-s-a9d0c-ed-first-actions-on-app-hub-chromium/test-failed-1.png`
- Error: `getByRole('button', { name: /connect model/i })` — element not found
- Root cause: `completeOnboarding()` creates Chief bot → `hasContent=true` → "First actions" section hidden

### Test 3 failure screenshot
`apps/web/test-results/hub-hub-Make-similar-creat-613bf-and-navigates-to-its-thread-chromium/test-failed-1.png`
- Error: `element was detached from the DOM, retrying` — React remount race during gallery scroll animation

### E2E execution log
Raw output: `artifact://1205`

---

## V3: Hardcoded Hex Evidence

### HubPage.tsx:90 — dynamic-data fallback (not a design token)
```tsx
style={{ backgroundColor: bot.color ?? "#6B7280" }}
```
`bot.color` is the bot's actual color from the database. `#6B7280` is only used as a Tailwind gray-500 fallback when the DB value is null.

### All HubPage.tsx color classes — semantic tokens
```tsx
className="... text-foreground"
className="... text-muted-foreground"
className="... border-border"
className="... text-white"
```

---

## Constitution Evidence

### Copy budget — zone titles
```tsx
const ZONE_ACTIVITY = "Activity";       // 1 word
const ZONE_GALLERY = "Gallery";         // 1 word
const ZONE_FIRST_ACTIONS = "Start";    // 1 word
```

### Semantic tokens — HubPage.tsx grep
```
text-foreground     : lines 64, 94, 183, 226
text-muted-foreground: lines 76, 101, 109, 133, 184, 210, 211, 213
border-border       : line 63
```

### Catalog entry count
7 entries in `INSPIRATION_CATALOG`:
- `market-research` (marketing)
- `code-review` (coder)
- `cloud-infra` (cloudops)
- `notion-knowledge` (chief)
- `content-calendar` (marketing)
- `github-automation` (coder)

---

## V4 Correction

Mobile home is `apps/mobile/app/index.tsx` (NOT `apps/web/src/pages/Home.tsx`).
- `apps/mobile/app/index.tsx`: unchanged in ba03becd
- Gallery rail is a wide-viewport pattern, not implemented on mobile
