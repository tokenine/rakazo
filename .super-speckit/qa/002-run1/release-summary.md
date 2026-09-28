# Release summary — 002-inspiration-hub (feature complete, code-side)

- Final SHA: `697a638f` on `ss/feature/002-inspiration-hub` (state: merged; also merged into `integration/001-multi-session-agents`)
- Matrix: V1–V4 verified + V5 verified + V6 pending PR (copy inventory at PR time) — see .super-speckit/qa/002-run1/qa-report.md
- Defect loop: 2 e2e test defects (E-1 fixture/E-2 locator) + 2 HIGH product findings the skeptical retest surfaced (F-002-A hub zone gating dead code / F-002-B createFromExpert DTO regression) — all fixed; final e2e 3/3 ×4 independent observations

## Verification recipe (required for the hub e2e — do not reuse stale servers)

apps/web "dev" is vite-only: playwright silently proxies /rpc+/api to whatever listens on 3100. The isolated recipe:
1. Fresh postgres container + `prisma migrate deploy`
2. Start the API from the branch: `cd apps/api && NODE_ENV=test EMAIL_EMULATOR=true SIGNUPS_ENABLED=true SIGNUP_ALLOWLIST="" DATABASE_URL=… pnpm start` (wait for "api listening" on 3100)
3. `pnpm --filter @rakazo/web exec playwright test hub.spec.ts` (vite starts fresh; proxies to the API above)
4. Kill the API process + container after

## Product changes

- `/app/hub` route (ShellPage hubEntry) — hub renders in shell chrome; shell auto-open and empty-space redirects no longer hijack it (3 × `!hubEntry` guards)
- HubPage zones: Activity (always; empty-safe), Gallery (always — the point of the hub), First-actions (iff `hasContent === false`)
- `inspiration.list` RPC + `INSPIRATION_CATALOG`/`CATALOG_VERSION` (6 cases, grayscale SVG assets, expertKey-resolved)
- Make-similar: `experts.create`-mechanics → navigates to `/app/:botId/:threadId` (mapped DTO with guaranteed primary threadId)
- Welcome.tsx hardcoded hex → semantic tokens (constitution debt cleared)
- Mobile: recorded degradation v1 (keeps existing Home + activity mode; reason documented per R1)

## Remaining (outside code authority)

1. Push/PR (integration branch carries everything). PR must include the R4 "Visible words" inventory (V6) and link the hub screenshots.
2. AutoClaw reference screenshots were never committed to the repo — if the maintainer supplies them, refine the hub visuals within the recorded design constraints.
