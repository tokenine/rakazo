# Spec: 007-cli-auth-handshake — `rakazo login` via browser authorization

## Why

The CLI's `login` requires pasting a bearer session token. There is no legitimate way for a normal
user to obtain one (copying cookies from dev-tools), and session tokens are full-power and expire.
Proven by real use on 2026-10-12: the only ways to onboard a CLI were SSH-to-database (agent with
root) or dev-tools cookie copying. A CLI needs a first-class, scoped, revocable credential issued
through a browser approval.

## Confirmed purpose (provenance)

User, this session: "it neee to be some auth" (after watching the CLI authenticate only via
server-side session reconstruction), then "run it" on the proposed browser-handshake change story.

## Requirements

- REQ-1 `rakazo login --server <url>` (no token) starts a one-time localhost listener, opens (and
  prints) the server's CLI-authorization URL, and completes without the user pasting anything.
- REQ-2 The authorization page authenticates the user with their normal web session and shows the
  requesting device/prompt with Allow / Deny. Deny (or closing the page) makes the CLI exit 3 with a
  structured error.
- REQ-3 Approving issues a **CLI token**: a distinct credential (not the browser session) stored
  hashed server-side, with name, creation time, last-used time; delivered to the CLI's loopback
  callback and stored by the CLI at 0600 (existing credentials store).
- REQ-4 CLI tokens authenticate like today's bearer tokens for all existing RPC calls (chat, steer,
  attach, approve, deny, status) and appear as a normal authenticated principal.
- REQ-5 `rakazo logout` / token revocation: the user can revoke any CLI token from the web settings
  UI; a revoked token stops working immediately (next call → AUTH_FAILED).
- REQ-6 `rakazo login --token <t>` keeps working as a fallback for headless machines where browser
  and CLI are on different hosts (print the authorize URL instead of auto-opening).
- REQ-7 Tokens never appear in logs, server responses after issuance, or error messages; the raw
  token is shown once at issuance only.

## Non-goals

- Token expiry by default (revocation-only lifecycle, stated in the approval UI).
- Multiple simultaneous pending handshakes per CLI invocation; device-authorization polling protocol
  (loopback delivery instead); better-auth plugin adoption (hand-rolled table instead — the installed
  better-auth has a device-authorization plugin, but it does not issue revocable, named, long-lived
  keys, which is the actual requirement).
- Mobile/desktop app login changes.

## Acceptance

- On the ai7 deployment: `rakazo login --server https://ai7.arisium.xyz` in a terminal → browser
  opens → Allow → CLI reports logged in; a chat works with the new token; revoke in settings → next
  chat fails AUTH_FAILED; deny path exits 3. `--token` fallback still works. Web settings list shows
  the token's name/created/last-used. Existing full test suite stays green; no behavior change for
  users who never use the CLI.

## Evidence base

- Server callback page pattern: apps/api/src/google-oauth-callback.ts:22-80 (HTML callback page,
  window.close); HMAC/authed POST pattern: apps/api/src/screen-proxy.ts; loopback URL rules:
  apps/desktop/src/oauth-callback.ts:8-35.
- Storage pattern: CodingSecretGrant revocable grant (packages/db/prisma/schema.prisma:1481-1498);
  hashed secrets precedent (UserModelCredential secretId; Artifact.hash). Revoke RPC precedents:
  connections.revoke (rpc.ts:769), aiConsent.revoke.
- Settings UI precedent: ModelSettingsOverlay.tsx list + revoke (apps/web/src/pages/).
- CLI store: apps/cli/src/credentials.ts; bearer acceptance: apps/api/src/app.ts:1050-1056.
- better-auth 1.7.4 has device-authorization plugin — evaluated, rejected for missing
  named/revocable/long-lived token semantics (see grill).
