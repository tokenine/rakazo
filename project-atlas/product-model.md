# Product model

**Product:** Ai7 (upstream project name `rakazo`; fork `tokenine/rakazo` of `elie222/rakazo`) — an AI agent workbench sold to enterprises as on-prem deployments, with a public demo. Rebrand runbook: `REBRAND-NOTES.md`; deployment snapshot: `docs/HANDOFF.md`. *(verified: docs/HANDOFF.md header)*

## Mission

Give every user a staff of persistent AI agents ("bots"/"experts") that each operate a real computer: they chat, run shell code, browse the web, use the user's own browser, and act on messaging channels — with orchestration, secrets, approvals, and memory owned by the server.

## Actors

| Actor | How they use the product | Evidence |
| --- | --- | --- |
| End user | Web UI (or Electron desktop hosting it, or Expo mobile) to create bots in spaces, chat in threads, attach files, watch the agent's computer screen, manage models/memory/integrations | apps/web/src/pages/Shell.tsx; apps/mobile/app/ |
| Messaging user | Chats with their bot over Telegram (text, photos, documents); bots reply and deliver artifacts back | packages/adapters/src/messaging-delivery.ts, apps/api/src/messaging-inbound.ts |
| Agent (bot) | Runs inside a per-bot no-root Linux "computer" sandbox with GUI + Chromium; can also drive the user's desktop browser pane when online | infra/sandboxes/, apps/desktop/src/client-browser/ |
| Operator | Runs the compose stack; manages deployment settings, signup policy, updater | infra/compose/, infra/updater/, packages/auth signup policy |

## Capabilities (user-facing outcomes)

- **Chat & agents** — persistent bots with sections/persona, threads, steering, routines (cron), approvals for sensitive actions.
- **Real computer work** — each bot gets a sandboxed desktop (X/fluxbox, Chromium, preinstalled CLI tools); agents control mouse/keyboard/screen and drive the browser via a playwright-core kernel.
- **Client browser** — the agent can operate the user's own desktop browser pane (Chrome profile import), preferred via a Built-in browser toggle.
- **Messaging surfaces** — Telegram (multi-bot per user), team chat, phone/SMS; inbound media becomes artifacts and vision input.
- **Models & voice** — provider-neutral model credentials (OpenRouter, OpenAI-compatible, Anthropic OAuth, local), voice providers for calls.
- **Memory & knowledge** — markdown memory store with revisions, per-space memory config, taught skills.
- **Integrations** — MCP servers (incl. OAuth), Composio, Pipedream, connectors; web search/fetch.
- **Artifacts** — files/images produced by runs, surfaced in threads and delivered over messaging.

*(verified: capability names trace to router groups in apps/api/src/router.ts and tool selection in packages/adapters/src/executor.ts)*

## Domain glossary

- **Space** — a workspace container for bots, threads, and memory config (`Space` model).
- **Bot / expert** — an agent definition (model, persona sections, tools, computer) (`Bot` model; `experts` RPC group).
- **Thread / Run / Task** — conversation; a queued/executing unit of agent work (`events.sendUserMessage` creates task+run); **Attempt** per execution try.
- **Computer** — a bot's sandbox VM instance (`Computer` model, supervisor-managed container).
- **Messaging identity** — mapping of provider+address → user/bot line (`MessagingIdentity`).
- **Artifact** — stored output file with metadata (`Artifact` model, `ArtifactStore` port).
