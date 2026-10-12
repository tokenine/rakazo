# Dependencies

Direction: Ai7 → external. Everything here is optional behind `adapter-kit` ports; the core product runs without any hosted vendor.

| External system | Port / seam | Implementations | Used for |
| --- | --- | --- | --- |
| PostgreSQL | Prisma client + Graphile queue | `packages/db`, worker host | All state, jobs, memory docs |
| Docker daemon | dockerode via supervisor | `infra/sandboxes/supervisor` | Per-bot computer containers |
| Sandboxes (hosted) | `SandboxProvider` | e2b, daytona, createos, box, docker, desktop, none (`packages/adapters/src/*-sandbox.ts`) | Alternative computer runtimes |
| LLM providers | `AgentRuntime`/`ModelProvider` | OpenRouter (default), OpenAI-compatible URLs, Anthropic OAuth, local provider (`pi-*.ts`) | Model inference |
| Telegram | chat-adapter + keyed wrapper | `telegram-keyed-adapter.ts` (one adapter per user bot row) | Messaging |
| Team chat / SMS | messaging surfaces | `team-chat-messaging.ts`, sendblue | Messaging |
| Email | `TransactionalEmailProvider` | SMTP, Cloudflare Email (`smtp-email.ts`, `cloudflare-email.ts`) | OTP mail, notifications |
| Voice | `VoiceProvider` | OpenAI, ElevenLabs, Cartesia, Fish Audio | Voice calls |
| Memory (hosted) | `MemoryStore`/`SemanticMemoryProvider` | Postgres markdown store (default), Supermemory, Serenity | Agent memory |
| Connectors | `ConnectorProvider` | Composio, Pipedream, MCP (remote + OAuth) | Third-party tools |
| Push | `NotificationProvider` | Expo push | Mobile notifications |
| Realtime | `RealtimeFanout` | Postgres-based fanout | SSE event streams |
| Analytics | — | PostHog (www), Axiom (api logs) | Marketing/observability |

Secrets flow: user credentials and bot tokens are encrypted via `EncryptedSecretStore` (record-scoped AAD); dev placeholders are blocked outside dev by `packages/core/src/secrets-guard.ts`.

Queue topology: Graphile Worker tables live in the same Postgres; jobs published by api, drained by worker (`run_continue`, `messaging.deliver`, `wake_routine`, computer lifecycle, cloud-agent polling) — `packages/adapters/src/background-job-handlers.ts`.
