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
| Cloudflare sandbox (optional provider) | `apps/cf-bridge` (bridge Worker + container image) + R2 bucket `ai7-computers` — guide: `docs/cloudflare-sandbox.md`. Enable with `SANDBOX_PROVIDER=cloudflare` + `CF_BRIDGE_URL`/`CF_BRIDGE_TOKEN` in server `.env` (compose passes them through, default stays docker). Deployed 2026-09-27 on branch `cloudflare` |

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
# install: quit app → mount dmg → rm -rf /Applications/Ai7.app → cp -R → codesign --force --deep --sign "Ai7 Local Dev"
# then: rm -rf apps/desktop/out/mac-universal   (prevents wrong-instance launches)
```

## 2. Architecture decisions that are LOCKED (do not re-litigate)

1. **Computer sandbox is no-root by design.** Containers run `USER 1000` + `CapDrop: ALL` + `no-new-privileges` (supervisor `computer-spec.ts`). Agents can never gain root (`sudo`/`su`/`docker exec -u 0 apt-get` all fail). Anything a task may need must be **baked into `infra/sandboxes/computer/Dockerfile`** (currently: pcmanfm, zip/unzip, jq, less, nano, sqlite3, Thai fonts, Node 22 + playwright-core + thaifi-wallet-cli). The system prompt tells bots "no root, work with preinstalled" (`packages/adapters/src/pi-runtime.ts`).
2. **Client browser pane = main-process WebContentsView**, NOT a `<webview>` tag. webview guests are CDP type `webview` which Playwright never exposes as a Page (and Electron CDP lacks Target.createTarget) — reverting this breaks `client_js` permanently. See `apps/desktop/src/client-browser/pane.ts` + `index.ts` (kernel). The renderer lays a placeholder div and IPCs its rect; the pane must stretch to the window bottom (Shell excludes the status strip when `panel === "browser"`).
3. **`client_js` kernel**: playwright-core over the app's own random `remote-debugging-port`; `tab` is PRE-BOUND into the model code scope (models skip `agent.browsers.tab()`); timeout is a graceful `Promise.race` — **never throw from a timer** (an old version crashed the whole app). Prefer real pages, fall back to the pane's fresh `about:blank`.
4. **Per-user Telegram = one adapter per bot row.** (replaced the old single-slot design, 2026-09-27) Each `messaging_telegram_bots` row registers under its own provider key `telegram-u<rowId>` via `createKeyedTelegramAdapter` (`packages/adapters/src/telegram-keyed-adapter.ts`) — the upstream `@chat-adapter/telegram` hardcodes name `"telegram"` + thread prefix `telegram:<chatId>` with no config option, and the Chat SDK routes everything (webhook map, inbound provider derivation, outbound `chat.thread()` selection, per-thread locks) on that prefix, so the wrapper shadows `name`/`encodeThreadId`/`decodeThreadId`/`resolveThreadId`/`openDM`/`channelIdFromThreadId` per instance (all internal call sites are `this.`-based). Webhook is per row: `/api/v1/messaging/webhook/telegram-user/<rowId>` dispatches by key; secret header verified inside the adapter. A user may connect MANY bots (`telegramBotId` from getMe de-dupes re-connects; `userId` is no longer unique); users coexist. Token encrypted via EncryptedSecretStore, recordId `tgbot-<userId>` (AAD shared across a user's rows — deliberate, no re-seal needed). Identity → row resolution: `messaging_identities.provider` embeds the row id; `sendTelegramArtifact` and the executor's `dmStatus` parse it (`rowIdOfTelegramUserProvider`). The deployment env bot (provider `telegram`) coexists untouched. Legacy identity rows with `provider='telegram'` are re-pointed by SQL at deploy time (else that user's inbound silently drops). **Worker reconciliation (commit 51c89e0)**: userConnect only touches the API's surface, so the worker re-runs `reconcileTelegramUserBots` (register missing / prune deleted / skip live) at boot and every 15s — without it, bots connected after a worker boot get ADAPTER_NOT_FOUND on every drain and replies pile up as `failed` rows while inbound still works.
5. **Browser fallback rule (user-approved standing order):** web tasks needing user logins → `client_js` first. If the pane is unavailable (no tab / desktop offline) → **fall back to the VM browser immediately, do not stop and ask**, mention once that logins are absent there. Sole exception: when the **Built-in browser** toggle is ON *and* the desktop is online (fresh heartbeat) the VM browser tools are stripped — require the pane. Toggle OFF, or user on web/mobile (desktop closed) → VM browser allowed.
6. **Built-in browser toggle** (Settings → General, desktop-only via `desktopBridge()`): `User.clientBrowserPreferred`; while ON + desktop online, `js`/`browser_navigate`/`browser_snapshot`/`browser_act` are stripped from the bot toolset (executor `clientBrowserOnly` → `pageBrowserAllowed = false`; best-effort lookup, never fails run setup).
7. **Cloudflare sandbox = externally durable home (treated like docker in workspace flows).** With `SANDBOX_PROVIDER=cloudflare` (branch `cloudflare`, 2026-09-27), each computer is a CF Container whose `/home/rakazo` is a tigrisfs mount of `R2 ai7-computers:homes/<homeKey>` — so `importWorkspace`/`exportWorkspace` are deliberate no-ops and checkpoints only bump the revision stamp (`computer-workspace.ts` skips copy for the kind). Disk is EPHEMERAL: anything outside the home (browser profiles at `/var/rakazo/browser-profiles`) is lost on sleep by design (v1 — FUSE locks). Container identity is stable across sleep (`providerRef` reused; the bridge re-mounts R2 on wake). CF can restart a container with default options — dropping the provision env — so `prepare()` self-heals: unmounted home ⇒ destroy + recreate via bridge (env re-stored), then wait for the mount (2026-09-28). Non-ASCII typing (Thai) via screen act goes through clipboard paste (`displayTypeCommand` in `extra-displays.ts`: xclip + Ctrl+V; `xclip` must exist in the image the bridge ACTUALLY builds = `apps/cf-bridge/container/Dockerfile` — the `computer/` copies are reference-only; a wrong-file edit still changes the digest and deploys an image without the package). Bridge details + earned gotchas: `docs/cloudflare-sandbox.md`.

## 2.5 Sign-up whitelist (LIVE on demo since 2026-09-28)

The deployment runs in **allowlist mode**: `deployment_settings.signupsEnabled=true` + `signupAllowlist='dome@tel.co.th,@dome.cloud,dome@tokenine.co'` (`signupPolicyInitialized=true` ⇒ DB beats env). Exact-email entries allow one address, `@domain` entries allow every address of that exact domain (no subdomains), empty list = open. Enforcement (better-auth hooks in `packages/auth/src/index.ts`): new emails are checked at BOTH `/email-otp/send-verification-otp` and `/sign-in/email-otp` (`400 "Email is not allowed to register"` — English, no Thai yet); **existing accounts are never blocked from signing in** (deliberate — owner decision 2026-09-28); the first-session bootstrap re-checks policy before claiming owner. Manage entries in Settings → Sign-ups (owner-only UI, textarea, newline/comma separated) — effective immediately, no restart. Direct SQL also works (`UPDATE deployment_settings SET "signupAllowlist"=...`). Requires the email provider to be configured or OTP endpoints 400 before the policy even runs.

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

## 7. Session log — 2026-09-28 evening (everything AFTER tag `handoff-2026-09-28`; branch head = d22069e)

Read §2.5 (whitelist) + this section first. Working state: `SANDBOX_PROVIDER=cloudflare` live, allowlist = `dome@tel.co.th,@dome.cloud,dome@tokenine.co`, three accounts exist (dome@tel.co.th, dome@dome.cloud, dome@tokenine.co — all "Dome").

0. **2026-09-29: UPSTREAM MERGED (main @ `65e58f18` = merge of elie222/rakazo main, 85 commits) + bs.ai7.work deployed as canary.** Second deployment is LIVE at **https://bs.ai7.work** on 119.59.123.107 (`/data/ai7`, project name `ai7`, `SANDBOX_PROVIDER=docker`, web bound `172.17.0.1:5174`, nginx server block in `/data/nginx/nginx.conf`, TLS = Cloudflare Flexible → origin port 80, **never add an http→https redirect there**). Conflict-policy highlights (full detail in git merge commit message): auth stays OTP-only (upstream's first-account admission gate targets the password path we replaced; ported `isBlockedAuthPath` prefix blocklist + `disableOrganizationDeletion`); `userTurnMessageForRun` keeps our messaging-trigger gate; executor keeps the `js` tool inside upstream's redaction/secret-fill shell; pi-runtime = upstream credential-store refactor + our zai-platform registration; computer image bakes Thai fonts + Node 22 + thaifi ON TOP of upstream CJK/locales/PATH profile; `DEFAULT_MODEL` on bs = `zai-platform`/`glm-5.3-flash` (regular `/api/paas/v4`; the builtin `zai` entry is relabeled "Z.AI Coding Plan"). macOS-portability fixes landed upstream-adjacent: egress `--print` works without the iptables binary, smoke `wc -l` trims whitespace, desktop-runtime release test stubs flock, smoke testkit 60s budget, mobile catalogs gained OTP strings. **Rebrand sweep must re-run after EVERY upstream merge** (`scripts/rebrand-display.sh Ai7 Rakazo` — TARGETS now cover adapters/web-scripts/computer; fix "a Ai7"→"an Ai7" after). **bs deploy required `docker pull busybox:1 postgres:16` first (`--pull never`)** and after editing `/data/nginx/nginx.conf` you MUST `docker restart nginx-proxy` (sed -i inode trap on single-file bind mounts). MCP OAuth client_name is now BRAND_NAME; on next connector connect Cloudflare shows "Ai7". WHENEVER 199 PULLS THIS MERGE IT MUST ALSO RUN `DELETE FROM mcp_oauth_sessions;` (one re-authorize per connector). 199 itself is still on branch `cloudflare` @ be38d10 — updating it is a deliberate separate step (its CF-sandbox mode is unaffected by the docker-path changes).

1. **MCP OAuth Cloudflare connector WORKS (env workaround) — proper gate fix still PENDING.** The connector had a two-gate pincer: rakazo's `mcp.oauth.begin` only accepts `${WEB_ORIGIN}/mcp/oauth/callback` while Cloudflare's AS rejects non-HTTPS non-loopback redirects. Browsing LAN (http://192.168.1.199:5174) → Cloudflare rejected; browsing tunnel → rakazo rejected. **Fix applied server-side: `WEB_ORIGIN=https://demo.ai7.work` in `/data/rakazo/.env`** (backup `.env.bak-weborigin-*`), api/worker/web recreated (`env_file` wiring). `BETTER_AUTH_URL`/`API_URL` deliberately STAY LAN http — changing them flips better-auth to `__Secure-` cookies and breaks LAN sign-in. **USER CONNECTED CLOUDFLARE SUCCESSFULLY after this.** Standing rule: **MCP OAuth connect only from `https://demo.ai7.work`** (LAN/aidex.tk9.dev still hit the gate for OAuth; everything else works from all origins). Proper fix (accept all trusted origins via `isTrustedCallbackOrigin` + widen `RouterDeps.env` with apiUrl/authUrl/extraOrigins) is fully designed in memory `rakazo-mcp-oauth-redirect-fix` — first attempt was abandoned mid-edit (session tooling glitch, tree reset to e774297); redo in a FRESH session.
2. **Sign-in OTP stage survives tab switches (commit 36e2c86, deployed)**: browsers discard/reload backgrounded tabs (Memory Saver) → the code-stage state (plain useState) reset to the email form. Now persisted in `sessionStorage["rakazo.auth.otp-stage"]` ({email, at}) with a 10-min TTL = server OTP expiry; cleared on success / "Use a different email". Verify trick: AuthPage is a LAZY chunk — grep `/app/apps/web/dist/assets/Auth-*.js` in the container for `rakazo.auth.otp-stage`, NOT index-*.js.
3. **Sidebar user-menu invisible for empty-name accounts (commit d22069e, deployed)**: OTP signups may skip the name field (`name=""`); `?? t`You`` kept the empty string → blank avatar+name row under the Integrations button. Fixed with `.trim() ||` fallback; also backfilled `dome@tokenine.co` name='Dome' directly in DB.
4. **Third bot "Chief" on dome@tokenine.co (cmulc021g…)**: fresh CF computer `cf-88b971ae-c258-4b16-8bb8-55940ffe26d5`, home `homes/team-11b725a6…`. Its VM landed in a NEW region (**icn07**; older ones ran hkg10) — first boot per region pulls/extracts the ~2GB desktop image → one-time slow boot, verified healthy after (mount + 16 desktop procs). Expect one slow cold boot per new region, then normal.
5. **Server 199 load ~8–10 is NOT rakazo** (containers at 1–3% CPU, 10.9GB RAM free) — it's the user's other host processes (bsc node etc.). VM boots happen on Cloudflare infra, unaffected by 199 load.
