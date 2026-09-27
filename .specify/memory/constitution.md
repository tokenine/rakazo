# Ai7 / Rakazo — Project Constitution

Ratified: 2026-09-28 · Amend by editing this file and recording the rationale in the change that introduces it.

`plan`, `tasks`, and `analyze` read this constitution at runtime; the plan template carries a
Constitution Check rather than freezing these rules. Keep this file narrow: normative rules
only. Factual system description lives in `project-atlas/`.

## 1. Product unity

One product across web, Electron desktop, and Expo mobile. Shared behavior, contracts, API
logic, and reusable UI live in packages; only genuinely native navigation, storage,
permissions, and interactions are platform-specific. Core workflows must cover every
applicable surface or degrade safely for an explicit, recorded reason.

## 2. Provider neutrality

No hosted vendor is required to run the core product. LLMs, sandboxes, memory, voice,
integrations, and future external services stay optional behind the ports in
`packages/adapter-kit`. Vendor SDKs, configuration, and translation belong only in
`packages/adapters` and composition roots. New providers reuse shared contracts and pass the
deterministic offline conformance tests. Never add provider- or model-specific environment
variables where the generic connection settings can express the behavior.

## 3. Layered authority

Frontends express intent and render state. The backend owns orchestration, authorization,
validation, retries, recovery, and provider translation (`apps/api`, `apps/worker`,
`packages/adapters/executor.ts`). `packages/core` stays dependency-free; `packages/contracts`
and `packages/adapter-kit` are the boundary vocabulary and change with a compatibility story,
not casually.

## 4. Locked architecture decisions

ADR-0001…0007 in `project-atlas/decisions/index.md` (sandbox no-root design, WebContentsView
client-browser pane, graceful `client_js` kernel, keyed Telegram adapters, browser fallback
rule, origin-sealed screen embeds, provider neutrality) are settled. A plan whose
constitution check would violate one must instead propose a formal amendment with evidence.

## 5. UI and copy discipline

Colors come from `@rakazo/ui-tokens` semantic tokens — never a hardcoded hex or arbitrary
`[var(--…)]`. Reuse vendored shadcn/Base UI components in `packages/ui-web` and the AI moments
in `apps/web/src/components/ai/` before writing chrome. The app is monochrome; bots carry the
only identity color. Mobile is native-first (Expo Router, native sheets/menus/alerts; custom
surfaces use shared tokens via `apps/mobile/lib/appearance`; system chrome stays
PlatformColor). Treat every visible word as UI: remove before adding, prefer progressive
disclosure, no persistent explainer text. PRs adding user-facing copy quote it and justify it.

## 6. Brownfield understanding and change safety

This is an existing, deployed codebase. Before material changes:

1. **Evidence before inference** — claims about current behavior cite a commit/path, test or
   contract, trace, or are explicitly labeled `inferred`/`unknown`. The atlas
   (`project-atlas/`) is descriptive context at its `manifest.yml` base commit, never proof.
2. **Domain before directory** — reason in capabilities, actors, systems, and contracts
   (`project-atlas/capability-map.md`); folder structure is evidence, not the model.
3. **Boundary preservation** — a change story names affected public contracts (RPC groups,
   adapter ports, Prisma models/migrations, messaging thread-id schemes), data ownership,
   integrations, and compatibility obligations before a plan passes its constitution check.
4. **Freshness and provenance** — after a merged change materially alters the model, refresh
   only the affected atlas sections from the diff and declare still-stale sections in
   `risks-and-unknowns.md`.
5. **Decision lineage** — durable architecture choices create or amend an ADR in
   `project-atlas/decisions/`; routine local choices create no ceremony.
6. **Explained-change gate** — no implementation begins for a material brownfield change
   until its change story explains before/after behavior, runtime path, blast radius, and the
   proof each requirement will get (requirements-to-verification matrix).

## 7. Security-sensitive surfaces

Auth, secret handling, sandbox boundaries, host commands, and integrations are
security-sensitive. Never commit secrets, `.env` files, private URLs, or real data — this is
a public repository. Protected paths (`auth/**`, `migrations/**`, `infra/**`, secrets) get
independent review per `super-speckit.yml` risk policy.

## 8. Verification honesty

Every requirement maps to a row in the verification matrix. Source inspection, clean exit
status, and static review are never sufficient proof of runtime behavior. Tests are
deterministic and offline by default (`packages/testkit` fakes/emulators). A blocked or
unverified item is reported as such — never converted to pass. Desktop Playwright e2e is not
run on maintainer machines; CI runs it on push.
