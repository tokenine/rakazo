# Architecture (C4 container view)

```text
 ┌───────────── clients ─────────────┐
 │ apps/web (React19/Vite SPA)       │ apps/desktop (Electron 44, bundles web build,
 │ apps/mobile (Expo 57/RN 0.86)     │   adds WebContentsView browser pane)
 │ apps/www (Astro marketing)        │
 └──────────────┬────────────────────┘
                │ oRPC over HTTP (contracts in @rakazo/contracts)
 ┌──────────────▼────────────────────────────────────────────┐
 │ apps/api — Hono + oRPC (/rpc/*), better-auth (/api/auth), │
 │   webhooks (/api/v1/messaging/webhook, /phone)            │
 │ apps/worker — Graphile job worker (same Postgres)         │
 │   (API and worker build the same executor wiring —        │
 │    symmetric, inferred: worker scales, API can run inline)│
 ├───────────────────────────────────────────────────────────┤
 │ shared packages (@rakazo/*):                              │
 │  contracts (wire/domain types) · core (pure domain logic) │
 │  adapter-kit (ports + AdapterRegistry) · adapters (vendor │
 │  impls + run executor) · auth · db (Prisma) · memory      │
 │  logging · chat-ui · ui-web · ui-tokens · testkit         │
 ├───────────────────────────────────────────────────────────┤
 │ PostgreSQL (Prisma models + Graphile jobs)                │
 └───────────────────────────────────────────────────────────┘
                │ dockerode
 ┌──────────────▼────────────────────────────────────────────┐
 │ infra/sandboxes/supervisor — creates per-bot "computer"   │
 │   containers (uid 1000, CapDrop ALL, no-new-privileges)   │
 │   from infra/sandboxes/computer image (X, Chromium,       │
 │   playwright-core kernel, CLI tools, Thai fonts)          │
 └───────────────────────────────────────────────────────────┘
```

## Layer rules (from AGENTS.md, enforced by package graph)

- `contracts` and `adapter-kit` depend on almost nothing — they are the boundary vocabulary.
- `core` is dependency-free domain logic; it never imports vendors.
- `adapters` is the only place vendor SDKs live; conformance tests (`sandbox-conformance`, `browser-conformance`, `cloud-agent-conformance`) pin port compliance; fakes/emulators in `testkit` keep tests offline.
- Frontends (`web`, `mobile`, `desktop` renderer) render state; orchestration, authorization, retries live in api/worker/executor.

## Process topology (compose)

Services (`infra/compose/docker-compose.yml`): `postgres`, `supervisor`, `computer` (image `rakazo/computer:local`), `data-init`, `api`, `worker`, `web`. The updater sidecar (`infra/updater`, port 7092) recreates the production stack from image tags, excluding itself. *(verified: compose file + updater-logic.ts)*
