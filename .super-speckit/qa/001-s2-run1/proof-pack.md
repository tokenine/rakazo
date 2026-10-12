# Proof pack — 001-multi-session-agents · S2 · Run 1

**Candidate**: `3d99186f` | **Worktree**: `ss/qa/001-s2-run1` | **Date**: 2026-09-28

## Gate evidence

| File | Description |
|---|---|
| `logs/db-test.log` | `pnpm --filter @rakazo/db test` — 125 passed / 6 skipped, exit 0 |
| `logs/adapters-test.log` | `pnpm --filter @rakazo/adapters test` — 2011 passed / 25 skipped, exit 0 |
| `logs/api-test.log` | `pnpm --filter @rakazo/api test` — 394 passed, exit 0 |
| `logs/check.log` | `pnpm check` — 22 tasks successful, exit 0 |

## Diff audit evidence

| File | Description |
|---|---|
| `logs/security-gate-diff.log` | `git show 3d99186f -- apps/api/src/app.ts` — security gate change (nodeEnv development\|\|test + instanceof check) |
| `logs/v10-grep.log` | `grep` over S2 new files for `thread.findFirst/findUnique(OrThrow)?(` — 0 unscoped botId-only hits |
| `logs/s2-files-changed.log` | `git diff --name-only 5262c142 3d99186f` — 16 files changed |

## V12/V13/V14 evidence

| File | Description |
|---|---|
| `logs/sessions-postgres.log` | `vitest run packages/testkit/src/sessions.postgres.test.ts` — 1 passed / 1 skipped on real Postgres (sessions-pg-test container :5433, credentials rakazo:rakazo) |
| `logs/v10-grep-new-files.log` | Grep of `Shell.tsx`, `session-switcher.tsx`, `App.tsx`, `sessions.postgres.test.ts` for botId-only thread lookups — only `findUnique({ where: { id } })` (id-scoped, exempt) |

## e2e evidence

| File | Description |
|---|---|
| `logs/e2e-note.log` | Playwright runner note: headless-shell device doesn't resolve SPA relative URLs; behavior verified via Playwright JS API with system Chrome (channel: 'chrome') |
| `logs/e2e-sessions-commands.log` | Annotated commands run during screenshot capture |
| `screenshot-01-main-chat.png` | Primary session view — session switcher trigger visible in bot chat header |
| `screenshot-02-session-switcher.png` | Session switcher popover open — primary session listed |
| `screenshot-03-after-create-session.png` | After creating "Research" session — URL changed to `/app/:botId/:threadId` |
| `logs/e2e-api-dev-emails.log` | GET `/api/dev/emails` returned OTP codes during signup flow |

## Session switcher component evidence

| File | Description |
|---|---|
| `apps/web/src/pages/shell/session-switcher.tsx` | New `SessionSwitcher` component (283 lines) — session list popover, create form, rename, delete |
| `apps/web/src/App.tsx` | New `/app/:botId/:threadId` route added |
| `apps/web/src/pages/Shell.tsx` | SessionSwitcher integrated into bot chat header (195 lines added) |

## DB-gated suite coverage

| Test file | Coverage |
|---|---|
| `packages/testkit/src/sessions.postgres.test.ts` | V12 (session.created/renamed/deleted events), V13 (active-run guard, primary promotion, last-session refusal), V14 (owner isolation) — all in 1 integration test |

## S1 rows confirmed through S2 surface

All S1 rows (V1–V11) stand from S1 qa-report.md §6. V1 confirmed additionally through api suite (394 tests including S2 RPC handlers) and DB-gated suite.
