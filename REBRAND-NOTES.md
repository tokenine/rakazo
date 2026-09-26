# Rebranding runbook

How to rename the product. Read the **Decision** section first — it decides how
much of this document applies. `REBRAND-NOTES.md` used to be a summary; this file
is now the complete reference.

- **Display-only rebrand** (recommended): the name users see changes; every
  technical identifier stays. Upstream `git pull` keeps working. Takes ~1 hour.
- **Full rebrand** (fork forever): additionally renames packages, env vars,
  image names, bundle IDs. Upstream merges become manual from that point on.
  Takes a day+ and needs migrations on the live server. See
  [Full rebrand (technical identifiers)](#full-rebrand-technical-identifiers).

All paths are relative to the repository root. Commands assume the repo root.

---

## Decision: what the name touches today

The fork already centralized user-visible branding. Current state (commit
3476489+):

**Read from `BRAND_NAME` (`packages/contracts/src/brand.ts`) — change one line:**

| File | Surface |
| --- | --- |
| `packages/auth/src/index.ts` | better-auth `appName`, OTP email subject/body |
| `packages/ui-web/src/bot-avatar.tsx` | `Wordmark` component (in-app logo + name) |
| `apps/web/src/pages/Welcome.tsx` | landing wordmark (76px) |
| `apps/web/src/pages/Auth.tsx` | "Sign in to …" / "Create your …" headings |
| `packages/contracts/src/openai-compatible-ui.ts` | model-connect hint copy |

**Literal strings — covered by `scripts/rebrand-display.sh <NEW_NAME>`:**

| Target | What it contains |
| --- | --- |
| `apps/web/src/locales/*/messages.po` (9 languages) | "Rakazo" inside translated strings (13 per catalog) |
| `apps/web/index.html` | `<title>` |
| `apps/desktop/src/setup.html`, `setup.js`, `main.ts`, `auto-update.ts` | setup screens, menus, error copy (~75 occurrences) |
| `apps/desktop/package.json` | `build.productName` (window/app name; NOT the appId) |
| `apps/mobile/app.json` | Expo `name` + local-network/camera permission strings (NOT bundleId/scheme) |
| `apps/mobile/lib/locales/ru.ts`, `zh.ts` | "Sign in to Rakazo" etc. |
| `apps/www/src` (site.ts + i18n + pages) | marketing site (~199 occurrences) |
| `packages/core/src/self-update.ts`, `secrets-guard.ts` | operator-facing messages |
| `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/` | documentation |

**Logo/wordmark assets (swap manually):**

| Path | Used by |
| --- | --- |
| `packages/ui-tokens/assets/` | `Rakazo.icon` (macOS icon source), in-app marks |
| `apps/www/public/brand/rakazo-mark.svg` (+ favicon set) | marketing site |
| `apps/desktop/assets/` | electron-builder buildResources (icon.png/icon.ico) |
| `apps/mobile/` | Expo icons/splash (app.json `icon`/`splash` fields) |

---

## Display-only rebrand — step by step

### 0. Pre-flight

1. Pick the name and check it is not trademarked in your markets; check domain
   availability if the product will have a public site (e.g. on Cloudflare).
2. Prepare logo assets before starting: square mark ≥1024px PNG (macOS icon
   needs `.icon`/icns conversion via `iconutil` or `electron-builder` from PNG),
   favicon set for www, mobile 1024px icon + splash.
3. Confirm a clean tree: `git status --porcelain` empty.

### 1. Single source

```bash
# packages/contracts/src/brand.ts
#   export const BRAND_NAME = "NewName";
```

Then `pnpm check` — every file reading `BRAND_NAME` typechecks against the new
value automatically.

### 2. Literal sweep

```bash
scripts/rebrand-display.sh "NewName"
```

The script sed-replaces the standalone capitalized word `Rakazo` (word-boundary
match, so `RakazoDesktop`/`isRakazoHealth` and lowercase identifiers survive),
covers the targets listed above **plus** `apps/web/src/pages`,
`apps/web/e2e`, `apps/desktop/src`, `apps/desktop/e2e`, and `apps/mobile/app`
+ `apps/mobile/lib` (mobile `t("…")` ids contain the brand word and must match
the swept ru/zh catalogs). Icon asset paths (`…/assets/Rakazo.icon`) are
re-pointed back to the existing artwork automatically — swap them only when
the logo itself changes. Review the diff — especially
`apps/desktop/package.json` (`productName` only must change; `appId` must not)
and `apps/mobile/app.json` (display `name` only; `bundleIdentifier`/`package`
/`scheme` must not).

### 3. i18n

```bash
pnpm --filter @rakazo/web exec lingui extract --clean
pnpm --filter @rakazo/web exec lingui compile
```

Brand names are not translated; the sweep already replaced them inside the
`.po` msgstrs. `lingui extract` reconciles line numbers and removes obsolete
messages. If `pnpm test` flags missing mobile locale keys, add the new-name
entries to `apps/mobile/lib/locales/ru.ts` and `zh.ts` (the i18n test enforces
every `t("…")` id to exist in both catalogs).

### 4. Emails

`packages/auth/src/index.ts` builds OTP/verification subjects from `BRAND_NAME`
automatically. If you want the sender display name to follow too, update
`EMAIL_FROM` in the server `.env` (e.g. `NewName <no-reply@tk9.dev>`) and
recreate `api`/`worker`. Cloudflare Email Sending only validates the domain,
not the display name.

### 5. Verify

```bash
grep -rn "Rakazo" --include="*.ts" --include="*.tsx" apps packages \
  | grep -v node_modules | grep -v locales | grep -v test
# expected: only technical identifiers (appId, URLs, repo names, RAKAZO_ comments)

pnpm check && pnpm lint && pnpm test
pnpm --filter @rakazo/web build   # catches the vite-config import chain
```

Manual pass: sign-up/sign-in headings, landing wordmark, OTP email (subject +
body), desktop setup window, www pages.

### 6. Ship

1. Commit + push to the fork; the server pulls and rebuilds (see
   `~/.agents/skills/rakazo-ops/SKILL.md` update flow).
2. Rebuild the desktop dmg with the same electron-builder command as always —
   it must be signed with the **"Rakazo Local Dev"** identity so the macOS
   Local Network grant survives the replacement (see Local Network section).
3. Mobile: rebranding the display name does not require a store rebuild; a
   changed icon does.

---

## Full rebrand (technical identifiers)

Only if you accept that **upstream merges become manual** and the live server
needs a migration. Each row: what it is, what breaks, what to do.

### `@rakazo/*` package scope — 20 packages, ~1,223 references

Every `package.json` name, every import statement, `pnpm-lock.yaml`, turbo
pipeline, CI workflows, and compose `pnpm --filter @rakazo/...` commands.

```bash
# mechanical part (review the diff; docs mention the scope too):
grep -rl "@rakazo/" --include="*.json" --include="*.ts" --include="*.yml" --include="*.yaml" . \
  | grep -v node_modules | grep -v pnpm-lock \
  | xargs sed -i '' 's|@rakazo/|@newscope/|g'   # macOS sed
rm pnpm-lock.yaml && pnpm install          # lockfile must regenerate
```

Consequences: upstream PRs no longer apply cleanly anywhere; CI must publish to
your own npm/GHCR namespace; Dockerfiles bake the scope via pnpm filters.

### `RAKAZO_*` environment variables — ~100 names, ~800 references

Read sites: `apps/api/src/env.ts` (central parser), desktop `main.ts`/`setup-config.ts`,
supervisor, updater, workflows, scripts, and every deployed `.env`.
Rename in code first, then migrate servers: for each renamed var add the new
value to `/data/rakazo/.env` **and remove the old key**, then
`docker compose up -d --force-recreate` every service that consumed it
(golden rule: env is read at container start). Forgetting one consumer leaves a
half-migrated deployment that only fails on the code path that reads it.

### Docker images & updater — `ghcr.io/elie222/rakazo/{app,computer,updater}`

Referenced by `docker-compose.images.yml`, `docker-compose.prod.yml`, the
updater sidecar, `packages/core/src/self-update.ts` (`OFFICIAL_REPO_URL`), and
asserted in updater/desktop tests. To move: set `RAKAZO_IMAGE`,
`RAKAZO_COMPUTER_IMAGE`, `RAKAZO_UPDATER_IMAGE` in `.env`, publish images to
your namespace, and update the tests that pin the upstream strings. The
self-update path tracks `elie222/rakazo` for stock deployments — forks that
self-build should leave it pointing at their own repo or disable the updater.

### Desktop identity — `dev.rakazo.desktop`

`appId` (electron-builder), the Electron session partition
`persist:rakazo-<sha256>` (`setup-config.ts`), the managed-stack probe path
`/.well-known/rakazo-desktop-stack` and header `x-rakazo-desktop-stack-token`
(`main.ts`, `packages/contracts/src/desktop.ts`). Renaming the appId changes
the macOS app identity (fresh TCC grants, new userData dir → all users sign in
again); renaming the partition signs everyone out; the probe path is a
**protocol between desktop and server** — both sides must ship together.
`contracts/desktop.ts` exports `Rakazo*` TypeScript names (wide but mechanical).

### Compose project names & volumes — `rakazo`, `rakazo-prod`

`docker-compose.images.yml` (`name: rakazo`) and `docker-compose.prod.yml`
(`name: rakazo-prod`, plus `COMPOSE_PROJECT_NAME` fallback). Renaming recreates
all volumes/networks under the new prefix. Migration on a live box:

```bash
docker compose --env-file .env -f <old files> down      # keeps bind mounts, drops containers
# rename in compose files, then up -d with the new project name
```

This deployment (192.168.1.199) uses **bind mounts** (`/data/rakazo/pgdata`,
`/data/rakazo/data`), so data survives regardless; upstream named-volume
deployments must copy volumes instead (`docker run --rm -v old:/src -v new:/dst
busybox cp -a /src/. /dst/`).

### Postgres defaults — user/db `rakazo`

Official postgres images apply user/db **only on first volume init**. Renaming
means one of:

```sql
-- in place (safe, preferred):
ALTER ROLE rakazo RENAME TO newuser;  ALTER DATABASE rakazo RENAME TO newdb;
```

then update `POSTGRES_USER`/`POSTGRES_DB`/`DATABASE_URL` in `.env` and restart
postgres + api + worker. `scripts/backup.sh`/`restore.sh` hardcode
`pg_dump -U rakazo rakazo` — update them in the same commit. Never recreate the
volume to rename.

### Mobile store identity — `com.rakazo.app`, scheme `rakazo`, module `com.rakazo.notifications`

Store-breaking: new bundle id = new app listing. Only relevant if the mobile
app is ever published. Also updates Kotlin package + manifest in
`apps/mobile/modules/rakazo-notifications/` and the deep-link scheme used by
`origin: "rakazo://"` in `apps/mobile/lib/api.ts`.

### systemd / ops files

`infra/systemd/rakazo-backup.{service,timer}`, `/etc/rakazo/backup.env`,
`/usr/local/sbin/rakazo-backup` — rename units, `systemctl daemon-reload`,
reinstall per `docs/self-host.md`.

---

## Known gotchas (learned the hard way)

1. **`packages/core` must not import `@rakazo/contracts`.** Node loads
   `core/node/*.ts` natively while bundling `vite.config.ts` and cannot remap
   the repo's `.js`→`.ts` source imports — the web image build fails at config
   load with `ERR_MODULE_NOT_FOUND …/src/*.js`. That is why `self-update.ts`
   and `secrets-guard.ts` keep the brand as a literal, covered by
   `scripts/rebrand-display.sh` instead.
2. **`productName` vs `appId`**: renaming `productName` changes the installed
   app name and the userData directory
   (`~/Library/Application Support/<productName>`) — users sign in again once.
   Renaming `appId` changes the macOS app identity itself: new TCC grants
   (Local Network!), no in-place upgrade. Pick deliberately.
3. **The macOS Local Network grant binds to the code signature.** After any
   rebuild, verify the app is still signed with the stable identity
   (`codesign -dv /Applications/Rakazo.app` → `Authority=Rakazo Local Dev`).
   An ad-hoc signature cannot hold the grant and the app will be silently
   blocked from LAN IPs — see `docs/self-host.md` and the rakazo-ops skill.
4. **Lingui cleanup**: after renaming strings, run `lingui extract --clean`;
   obsolete msgids vanish and `pnpm test` should stay green. Mobile has a test
   that fails when a `t("…")` id is missing from the ru/zh catalogs.
5. **Tests assert brand strings** (web e2e headings like "Create your Rakazo",
   `index.test.ts` OTP subject). `rebrand-display.sh` covers `.po` and e2e
   sources; `packages/auth/src/index.test.ts` reads `BRAND_NAME` output, so it
   follows automatically.
