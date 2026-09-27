# Capability map

Capability → owning component(s) → outcome. All rows verified against the cited files.

| Capability | Owns it | User-facing outcome |
| --- | --- | --- |
| RPC surface | `apps/api/src/router.ts` (oRPC, 40 groups) mirrored by `packages/contracts/src/rpc.ts` | Every client operation (threads, bots, models, computer, messaging, artifacts…) |
| Auth & signup | `packages/auth` (Better Auth + email OTP); signup policy in `packages/core/src/signup-policy.ts` | Passwordless sign-in; org membership; fail-closed signup |
| Run orchestration | `packages/adapters/src/executor.ts` (`createRunExecutor`, `continueRun`) | Message → queued run → executed with tools → assistant reply + artifacts |
| LLM runtime | `packages/adapters/src/pi-runtime.ts`, `pi-models.ts`, `openai-compatible-url.ts`, `pi-anthropic-oauth.ts` | Model calls with steering, tool loop, thinking budgets, session recording |
| Model credentials | `packages/core/src/model-providers.ts`, `packages/db/src/repos.ts` (model-credentials) | Per-user/per-space model selection, OAuth vs API-key credentials |
| Sandboxes | `packages/adapters/src/sandbox-factory.ts` + docker/e2b/daytona/createos/box providers; `infra/sandboxes/supervisor` creates the computer container | Per-bot no-root Linux desktop the agent can operate |
| Browser tools (VM) | `packages/adapters/src/browser-tools.ts`, `computer-browser.ts`, kernel `infra/sandboxes/computer/rakazo-browser-kernel.mjs` | Agent drives Chromium inside the sandbox via playwright-core |
| Client browser (user's desktop) | `apps/desktop/src/client-browser/` (pane.ts WebContentsView, Chrome profile import) + `packages/adapters/src/client-browser-tools.ts` | Agent operates the user's real logged-in browser when desktop is online |
| Background jobs | `apps/worker` + Graphile queue; handlers in `packages/adapters/src/background-job-handlers.ts` | Run continuation, delivery, routines, computer sleep/update, cloud-agent polling |
| Messaging inbound | `apps/api/src/messaging-webhook.ts`, `messaging-inbound.ts` | Telegram/media → identity lookup → thread message → run |
| Messaging outbound | `packages/adapters/src/messaging-delivery.ts`, `telegram-keyed-adapter.ts` | Replies/artifacts delivered to Telegram etc.; anti-spam caps; per-row bot adapters |
| Artifacts | `ArtifactStore` port; `apps/api/src/artifacts.ts`; `createOwnedArtifact` ingest | Files/images stored, surfaced in threads, delivered as attachments |
| Memory | `packages/memory` (MarkdownMemoryStore over Postgres) + provider factories in adapters | Persistent, revisable agent memory per space |
| Approvals & consent | `packages/core/src/action-approval.ts`, `ai-consent.ts`; executor gating | Sensitive agent actions require user YES/NO; AI data-sharing consent |
| Secrets | `EncryptedSecretStore`, `packages/core/src/secrets-guard.ts`, bot/agent secrets | Credentials encrypted at rest; dev placeholders blocked |
| Web UI shell | `apps/web/src/pages/Shell.tsx` + overlays; components from `packages/ui-web`, tokens from `packages/ui-tokens` | Threads, bots, computer panel (noVNC), client-browser panel, settings |
| Desktop app | `apps/desktop/src/main.ts`, `client-browser/`, `local-stack.ts`, `auto-update.ts` | Bundled web UI + client browser pane + local docker stack + self-update |
| Mobile app | `apps/mobile` (Expo Router), `lib/api.ts` | Thread/chat/computer/voice on native, native-first styling |
| Voice | `packages/adapters/src/voice-factory.ts` + four vendor adapters | Voice calls with agents |
| Deployment/update | `infra/compose/`, `infra/updater` (compose sidecar) | Self-updating on-prem stack |
| Marketing site | `apps/www` (Astro) | Public site + demo links |
