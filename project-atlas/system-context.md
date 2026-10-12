# System context (C4 level 1)

```text
                    ┌──────────────┐   email OTP   ┌────────────────────┐
   End users ───────▶│  Ai7 system  │──────────────▶│ SMTP / Cloudflare  │
   (web, desktop,    │              │               │ Email              │
   mobile, Telegram) │              │               └────────────────────┘
        ▲            │              │   Bot API     ┌────────────────────┐
        │  Telegram  │              │──────────────▶│ Telegram           │
        └───────────▶│              │               └────────────────────┘
                     │              │   LLM APIs    ┌────────────────────┐
                     │              │──────────────▶│ OpenRouter / OpenAI│
                     │              │               │ compatible /       │
                     │              │               │ Anthropic / local  │
                     │              │               └────────────────────┘
                     │              │   containers  ┌────────────────────┐
                     │              │──────────────▶│ Docker (computer   │
                     │              │               │ sandboxes), E2B,   │
                     │              │               │ Daytona, CreateOS  │
                     │              │               └────────────────────┘
                     │              │   MCP/conn.   ┌────────────────────┐
                     │              │──────────────▶│ MCP servers,       │
                     │              │               │ Composio, Pipedream│
                     │              │               └────────────────────┘
                     │              │   push/voice  ┌────────────────────┐
                     │              │──────────────▶│ Expo push, Eleven- │
                     │              │               │ Labs/Cartesia/Fish │
                     └──────────────┘               └────────────────────┘
                            │ store/search
                            ▼
                     ┌──────────────┐
                     │ PostgreSQL   │ (Prisma + Graphile job queue + memory docs)
                     └──────────────┘
```

All vendor dependencies are optional behind provider-neutral ports — the core product runs with no hosted vendor required (AGENTS.md; ports in `packages/adapter-kit/src/interfaces.ts`).

## Trust boundaries

1. **User clients ↔ API** — Better Auth sessions/bearer tokens; passwordless email OTP only (`packages/auth/src/index.ts`).
2. **API/worker ↔ sandboxes** — supervisor creates containers as uid 1000 with `CapDrop: ALL` + `no-new-privileges`; agents can never gain root (`infra/sandboxes/supervisor/src/computer-spec.ts`, `docs/HANDOFF.md` §2.1).
3. **Agent ↔ user's desktop browser** — desktop main-process WebContentsView pane + private CDP port loopback-restricted; `client_js` kernel talks only to the app's own random debugging port (`apps/desktop/src/client-browser/`).
4. **Webhook ↔ API** — per-provider shared-secret headers (Telegram secret header, Meta signature, sendblue secret) verified in `apps/api/src/messaging-webhook.ts`.
5. **Screen embeds** — noVNC capability sealed against the request's own origin (`rpcRequestOrigin()`, `apps/api/src/app.ts`; new origins require `RAKAZO_EXTRA_ORIGINS`).
