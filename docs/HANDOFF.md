# Ai7 — Session Handoff

> Snapshot: 2026-09-27 · tagged `handoff-2026-09-27` · live deployment verified working
> Product: **Ai7** (fork `tokenine/rakazo` of `elie222/rakazo`) — AI agent workbench sold to enterprises (on-prem), demo at **https://aidex.tk9.dev** and **https://demo.ai7.work**
> Read this top-to-bottom before touching anything. Ops runbook: `~/.agents/skills/rakazo-ops/SKILL.md` (server-side detail), rebrand runbook: `REBRAND-NOTES.md`.

---

## 1. Where everything lives

| Thing | Where |
| --- | --- |
| Local clone (work here) | `~/project/xxAgent/rakazo` — push to `tokenine/rakazo` main; server pulls from there |
| Server | `ssh root@192.168.1.199` → `/data/rakazo` (source-checkout docker compose; `.env` chmod 600, never print) |
| Compose | from `/data/rakazo`: `docker compose --env-file .env -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.override.yml …` |
| Web / API / tunnel | LAN `http://192.168.1.199:5174`, API `127.0.0.1:3100` (loopback), tunnel `https://aidex.tk9.dev` (+ `demo.ai7.work`, both live) |
| Desktop app | **/Applications/Ai7.app** — rebuild on EVERY server main move (it bundles its own web UI). ⚠️ `apps/desktop/out/mac-universal/Ai7.app` is a build-dir duplicate that hijacks `open -a Ai7` — delete it after every electron-builder run |
| Computer sandbox image | `rakazo/computer:local`, built from `infra/sandboxes/computer/Dockerfile` — ALWAYS include `computer` in the update-flow build |

Update flow (from server):

```bash
cd /data/rakazo && git pull origin main
docker compose --env-file .env -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.override.yml \
  build api worker web computer
docker compose --env-file .env -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.override.yml \
  up -d --wait --pull never
curl -fsS http://127.0.0.1:3100/health   # then: curl -fsS https://aidex.tk9.dev/ | grep title
```

Desktop rebuild (local):

```bash
pnpm --filter @rakazo/web build && pnpm --filter @rakazo/desktop build
pnpm --filter @rakazo/desktop exec electron-builder --mac --universal --publish never \
  -c.mac.notarize=false -c.forceCodeSigning=false
# install: quit app → mount dmg → rm -rf /Applications/Ai7.app → cp -R → codesign --force --deep --sign "Rakazo Local Dev"
# then: rm -rf apps/desktop/out/mac-universal   (prevents wrong-instance launches)
```

## 2. Architecture decisions that are LOCKED (do not re-litigate)

1. **Computer sandbox is no-root by design.** Containers run `USER 1000` + `CapDrop: ALL` + `no-new-privileges` (supervisor `computer-spec.ts`). Agents can never gain root (`sudo`/`su`/`docker exec -u 0 apt-get` all fail). Anything a task may need must be **baked into `infra/sandboxes/computer/Dockerfile`** (currently: pcmanfm, zip/unzip, jq, less, nano, sqlite3, Thai fonts, Node 22 + playwright-core + thaifi-wallet-cli). The system prompt tells bots "no root, work with preinstalled" (`packages/adapters/src/pi-runtime.ts`).
2. **Client browser pane = main-process WebContentsView**, NOT a `<webview>` tag. webview guests are CDP type `webview` which Playwright never exposes as a Page (and Electron CDP lacks Target.createTarget) — reverting this breaks `client_js` permanently. See `apps/desktop/src/client-browser/pane.ts` + `index.ts` (kernel). The renderer lays a placeholder div and IPCs its rect; the pane must stretch to the window bottom (Shell excludes the status strip when `panel === "browser"`).
3. **`client_js` kernel**: playwright-core over the app's own random `remote-debugging-port`; `tab` is PRE-BOUND into the model code scope (models skip `agent.browsers.tab()`); timeout is a graceful `Promise.race` — **never throw from a timer** (an old version crashed the whole app). Prefer real pages, fall back to the pane's fresh `about:blank`.
4. **Per-user Telegram = one adapter per bot row.** (replaced the old single-slot design, 2026-09-27) Each `messaging_telegram_bots` row registers under its own provider key `telegram-u<rowId>` via `createKeyedTelegramAdapter` (`packages/adapters/src/telegram-keyed-adapter.ts`) — the upstream `@chat-adapter/telegram` hardcodes name `"telegram"` + thread prefix `telegram:<chatId>` with no config option, and the Chat SDK routes everything (webhook map, inbound provider derivation, outbound `chat.thread()` selection, per-thread locks) on that prefix, so the wrapper shadows `name`/`encodeThreadId`/`decodeThreadId`/`resolveThreadId`/`openDM`/`channelIdFromThreadId` per instance (all internal call sites are `this.`-based). Webhook is per row: `/api/v1/messaging/webhook/telegram-user/<rowId>` dispatches by key; secret header verified inside the adapter. A user may connect MANY bots (`telegramBotId` from getMe de-dupes re-connects; `userId` is no longer unique); users coexist. Token encrypted via EncryptedSecretStore, recordId `tgbot-<userId>` (AAD shared across a user's rows — deliberate, no re-seal needed). Identity → row resolution: `messaging_identities.provider` embeds the row id; `sendTelegramArtifact` and the executor's `dmStatus` parse it (`rowIdOfTelegramUserProvider`). The deployment env bot (provider `telegram`) coexists untouched. Legacy identity rows with `provider='telegram'` are re-pointed by SQL at deploy time (else that user's inbound silently drops).
5. **Browser fallback rule (user-approved standing order):** web tasks needing user logins → `client_js` first. If the pane is unavailable (no tab / desktop offline) → **fall back to the VM browser immediately, do not stop and ask**, mention once that logins are absent there. Sole exception: when the **Built-in browser** toggle is ON *and* the desktop is online (fresh heartbeat) the VM browser tools are stripped — require the pane. Toggle OFF, or user on web/mobile (desktop closed) → VM browser allowed.
6. **Built-in browser toggle** (Settings → General, desktop-only via `desktopBridge()`): `User.clientBrowserPreferred`; while ON + desktop online, `js`/`browser_navigate`/`browser_snapshot`/`browser_act` are stripped from the bot toolset (executor `clientBrowserOnly` → `pageBrowserAllowed = false`; best-effort lookup, never fails run setup).

## 3. Screen embeds (black-screen fix — keep this pattern)

`computer.screenUrl` seals the noVNC capability against **the request's own origin** (`rpcRequestOrigin()` in `apps/api/src/app.ts`: origin header → `x-forwarded-proto`+`host`; trust = `WEB_ORIGIN`/`API_URL`/`AUTH_URL`/`RAKAZO_EXTRA_ORIGINS`/loopback; fallback `WEB_ORIGIN`). Any NEW client origin must be added to `RAKAZO_EXTRA_ORIGINS` or embeds break again. Unit tests: `apps/api/src/request-origin.test.ts`.

## 4. Telegram end-to-end (all verified live on @domedemo_bot)

| Path | State |
| --- | --- |
| text Telegram → bot → thread | ✅ |
| bot reply (text) → Telegram | ✅ worker registers user bots at boot; `deliverMessaging` mirror sends text |
| bot-generated images → Telegram | ✅ `mirrorRun` emits outbox rows `kind:"image"` + `artifactId`; drain reads `DATA_DIR/artifacts/<spaceId>/<storageKey>` and uploads multipart (`sendPhoto`/`sendDocument`, ≤50 MB) with the linked user's decrypted bot token (`sendTelegramArtifact` in messaging-delivery.ts) |
| user photo/document → model | ✅ inbound handler downloads `event.media[].fetch()` (adapter closure — token stays internal; `mediaUrl` is ALWAYS null for telegram, do not rely on it), ingests via `createOwnedArtifact` (≤25 MB), appends an image block to the user message |
| model sees the image | ✅ `userTurnBlocksForRun` allows `trigger === "user" | "messaging"` (was user-only — that gate silently dropped telegram images) |

Diagnostics: webhook info via decrypted token inside the api container; inbound hits = `docker logs rakazo-api-1 | grep telegram-user`; link codes live 10 min in `messaging_link_codes`; identities in `messaging_identities` (unique per provider+address).

## 5. Known gaps / next steps (priority order)

1. **Inbound attachment UX** — **DONE 2026-09-27**: every inbound telegram/media attachment ingests as an artifact and surfaces in the thread UI. Photos → `image` blocks (vision input, unchanged); any other document → `file` block (`ArtifactFileCard` in the web UI, no changes needed there). Messaging ingest accepts ANY mime (`createOwnedArtifact(..., { allowAnyMimeType: true })`), 25 MB cap (`decodeAttachmentBase64` takes `maxBytes`), up to `ATTACHMENT_MAX_COUNT` (4) attachments per message (was `[0]` only), and documents get a `User attached file …` prompt note (web-parity via `promptTextForAttachments`). Still true but separate: the model cannot READ document contents on the messaging path (`loadCurrentTurnImages` is image-only) — it sees `[file: …]` in history + the prompt note.
2. **Multi-bot telegram** — **DONE 2026-09-27**: unlimited bots, many per user and many users side by side (see §2.4 for the keyed-adapter architecture). RPCs: `userConnect` returns `botId`, `userDisconnect` takes `{botId}`, `userStatus` returns `{bots:[{id,username}]}`; UI card is a list. Remaining known limits: each rakazo bot still links to exactly ONE chat line (`messaging_identities.botId @unique` — relinking a line re-points the bot); legacy `messaging_outbound` group rows with `telegram:` thread ids need the env bot to deliver (none in this deployment).
3. **Streaming/stale-knowledge** — **DONE 2026-09-27**: the executor injects `messagingLiveStatusNote(...)` into EVERY run's instructions, built from DB truth at run start (`messaging.dmStatus` = identity provider + owner's telegram bot handle, `createMessagingContextLoader`). Bots can no longer claim "Telegram not connected" from stale memory. Prompt text: `packages/core/src/messaging-prompts.ts`; tests: `messaging-prompts.test.ts`, `messaging-context.test.ts`.
4. **Windows Chrome import** (App-Bound stub), **WebM screen recording**, **Gmail/Calendar connectors** — deferred by user choice earlier.
5. **model vision gate** — **VERIFIED 2026-09-27, no pipeline bug**: `glm-5.3-flash` (opencode-go) is vision-capable per the Pi catalog (`input: ["text","image"]`) — telegram photos DO reach Chief's GLM model. `qwen3.7-plus` (openai-compatible) is gated OFF by configuration: both `user_model_credentials` rows have `supportsImages=false` and openai-compatible requires an explicit per-model vision list in the secret. If vision is wanted on qwen: enable "supports images" for that connection in Settings.

## 6. Session gotchas (all painfully earned)

- `pnpm check` (typecheck) — run it; `pnpm lint` (biome); `pnpm test` (vitest, ~4.5k tests). Don't pipe-then-`&&` on their exit codes — a `| grep`/`| tail` masks failures (bit twice).
- `pnpm --filter @rakazo/db generate` after ANY schema change; migrations are plain SQL folders, applied by the api container on boot.
- Biome: `npx biome check --write <files>` after hand-edits; formatter rejects multi-line chains it wants collapsed.
- Bash heredocs + python one-liners mangle backslash/backtick escaping through the tool JSON layer — write scratch scripts with the Write tool instead.
- Server psql from host: camelCase columns need `\"double quotes\"` INSIDE the docker exec string — mind the quote layers (ssh '… docker exec … psql -c "… \"col\" …"').
- LOG_LEVEL=debug is currently SET in server `.env` (added for telegram debugging) — remove if log noise matters.
- Test identity row `telegram-utest / 888000001` may exist in `messaging_identities` (from a probe) — harmless, deletable.
