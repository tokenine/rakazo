# Bot computers on Cloudflare Containers (SANDBOX_PROVIDER=cloudflare)

Run rakazo bot computers as Cloudflare Worker Containers instead of the local
Docker supervisor. The bot's home directory lives in **one R2 bucket**, split
per user/bot (`homes/<homeKey>/…`), and is FUSE-mounted into the container at
boot — so the container's ephemeral disk can be discarded on sleep without
losing anything. Deployed 2026-09-27 (branch `cloudflare`).

```
rakazo api/worker (your VM) ──HTTPS+bearer──▶ cf-bridge Worker (Cloudflare)
                                                 └─ Container binding ─▶ computer container
exec/files/input/observe = agent HTTP on :8090 (getTcpPort)
screen = noVNC + websockify through the bridge (WebSocket upgrades included)
home  = tigrisfs mount of  <bucket>:homes/<homeKey>  at /home/rakazo
```

## Prerequisites

- Cloudflare account with **Workers Paid** (Containers require it) — the
  account also needs the Containers beta/GA enabled.
- `wrangler` v4+ (`npm i -g wrangler`).

## One-time setup

```bash
# 1. R2 bucket (one per deployment, partitioned by homes/<homeKey>)
wrangler r2 bucket create ai7-computers

# 2. R2 S3 token (dashboard only — no API exists):
#    dash.cloudflare.com → R2 → Manage R2 API Tokens → Create API Token
#    scope: Object Read & Write on ai7-computers only.
#    Keep the Access Key ID + Secret Access Key.

# 3. Bridge Worker + container image
cd apps/cf-bridge
#    edit wrangler.jsonc vars: R2_ACCOUNT_ID, R2_BUCKET
wrangler secret put BRIDGE_TOKEN          # openssl rand -hex 32
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler deploy                            # first build is slow (desktop image)
wrangler containers list                   # wait for state != provisioning

# 4. Point the rakazo stack at it (.env, then recreate api+worker)
SANDBOX_PROVIDER=cloudflare
CF_BRIDGE_URL=https://cf-bridge.<subdomain>.workers.dev
CF_BRIDGE_TOKEN=<the token from step 3>
```

Switch back to local Docker any time: set `SANDBOX_PROVIDER=docker` and
recreate api+worker. Nothing on the Cloudflare side needs cleaning up
(computers sleep to zero; delete `homes/…` prefixes in R2 to reclaim space).

## What lives where

| Thing | Location |
| --- | --- |
| Bot home (files, wallet keys, bot workspaces) | R2 `ai7-computers/homes/<homeKey>/…` |
| Browser profiles | container disk `/var/rakazo/browser-profiles` (ephemeral — v1 tradeoff, FUSE locks) |
| Control agent | `apps/cf-bridge/container/agent.js` (`:8090`, runs as uid 1000) |
| Desktop stack | same as Docker computer image (`apps/cf-bridge/container/computer/` — keep in sync with `infra/sandboxes/computer/`) |

## Earned gotchas

- **Credentials must go through `--shared-config`** (a file). The image sets
  `HOME=/home/rakazo`, so the AWS default path resolves inside the bot home,
  and the env-var chain is unreliable in this runtime. File:
  `/var/rakazo/r2-credentials`, written by `startup-cf.sh` from the container
  env the bridge passes at start.
- **tigrisfs needs `-f`** (foreground). Background mode daemonizes with
  fork+setsid, which the container sandbox rejects (EPERM) and the mount dies
  right after "successfully mounted".
- **tigrisfs logs go to `/var/log/tigrisfs.log`** unless `--log-file` is set —
  not to the shell redirect. The agent's `/agent/debug` endpoint prints the
  real logs; use it before anything else when a mount misbehaves.
- **Instance sizing**: `instance_type` in `apps/cf-bridge/wrangler.jsonc`.
  `basic` (0.25 vCPU/1 GiB) is too small for Xvfb+Chromium — containers die at
  boot. `standard` (0.5 vCPU/4 GiB) works; raise it if bots feel slow.
- **Only env-carrying starts are valid**: the Worker stores provision env in
  DO storage and `ensureStarted()` re-applies it before any proxy — a bare
  fetch would auto-start a computer with no R2 home. **Cloudflare can still
  restart a container with default options** (observed after a crash/
  maintenance restart): the boot then logs `no R2 credentials`, stays up with
  a skeleton home, and every run's setup fails with `workspace is not mounted`
  until the retry cap. `prepare()` self-heals this (2026-09-28): it waits
  ~20 s for the mount, then destroys + recreates the container through the
  bridge (which re-stores env from Worker secrets) and waits up to ~90 s for
  the mount before letting the run proceed. The same path also heals a DO
  whose stored env was lost (`computer not provisioned`).
- **Rollout lag**: after `wrangler deploy`, running containers keep the old
  image; new containers get the new one only once the application rollout
  finishes (`wrangler containers list` shows `provisioning` while it runs).
  Delete + re-provision a test computer after the rollout settles.
- The computer image in `apps/cf-bridge/container/computer/` is a **copy** of
  `infra/sandboxes/computer/` — update both together (Dockerfile COPY paths
  gain a `computer/` prefix in the CF variant).

## Cost shape

- Containers bill only while awake (sleep after 10 min idle; keepAlive pings
  extend it during runs) — `standard` class, plus R2 storage for homes.
- R2 storage: ~$0.015/GB-month; a demo deployment's homes were ~2 GB.
