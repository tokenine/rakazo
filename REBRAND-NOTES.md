# Rebranding notes

The product name is centralized where practical. Display-only rebranding does
not touch technical identifiers, so `git pull` from upstream keeps working.

## Where the name lives

**Runtime — change `BRAND_NAME` in `packages/contracts/src/brand.ts`:**

- `packages/ui-web/src/bot-avatar.tsx` (`Wordmark` component)
- `apps/web/src/pages/Welcome.tsx` (landing wordmark)
- `apps/web/src/pages/Auth.tsx` (sign-in headings)
- `packages/auth/src/index.ts` (`appName`, email templates)
- `packages/core/src/self-update.ts`, `packages/core/src/secrets-guard.ts`
- `packages/contracts/src/openai-compatible-ui.ts`

**Literal — run `scripts/rebrand-display.sh <NEW_NAME>`:**

- `apps/web/src/locales/*/messages.po` (Lingui catalogs, 9 languages)
- `apps/web/index.html`, desktop setup screens and menu copy
- `apps/desktop/package.json` (`productName`), `apps/mobile/app.json` (display name)
- `apps/www` copy, README, docs

**Assets:** `packages/ui-tokens/assets/`, `apps/www/public/brand/` (logo/wordmark SVGs).

## Deliberately NOT rebranded (technical identifiers)

Renaming these breaks upstream git-pull compatibility and existing deployments:

- `@rakazo/*` package scope (~1,223 references, 20 packages)
- `RAKAZO_*` environment variables (~100 names — `.env` files would break)
- `ghcr.io/elie222/rakazo/*` image references + updater/self-update logic
- Desktop `appId: dev.rakazo.desktop`, Electron session partition
  `persist:rakazo-*`, stack-probe path `/.well-known/rakazo-desktop-stack`
- Compose project names (`rakazo`, `rakazo-prod`) + volume/network names
- Postgres defaults (`POSTGRES_DB=rakazo`) + backup/restore scripts
- Mobile bundle IDs (`com.rakazo.app`) / URL scheme (store identity)

Changing any of these is a fork-forever decision: coordinate migrations for
existing volumes (compose `down -v` destroys Postgres state) and accept that
future upstream merges become manual.

## Auth note

Sign-in is passwordless (email OTP via better-auth `emailOTP` plugin). A
deployment without an email provider (Cloudflare Email Sending, `SMTP_URL`, or
the dev emulator) cannot admit sign-ins — `/api/auth/capabilities` reports
`otp: false` and both web and mobile clients surface that state.
