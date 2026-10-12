# Research: 007-cli-auth-handshake (2026-10-12)
- Reuse server callback page: google-oauth-callback.ts:22-80 (self-contained HTML, window.close).
- Authed POST pattern: screen-proxy.ts (HMAC cap); loopback URL rules: desktop oauth-callback.ts:8-35.
- Storage: copy CodingSecretGrant revocable-grant shape (schema.prisma:1481-1498) → new CliToken
  table {id,userId,name,tokenHash,createdAt,lastUsedAt,revokedAt}; store SHA-256 hash only.
- Auth: extend apps/api/src/app.ts sessionHeaders/actor resolution so a valid CLI token hash lookup
  yields the same actor as bearer sessions (single choke point at app.ts:1050-1056).
- Delivery: CLI listens on 127.0.0.1:<ephemeral>; authorize page POSTs token to
  http://127.0.0.1:<port>/callback?token=…&state=… (server-to-localhost, loopback only).
  Headless fallback REQ-6: authorize page displays the token once for manual paste.
- Settings UI: ModelSettingsOverlay.tsx list+revoke precedent; add CLI tokens panel in
  AccountSettingsOverlay or SettingsOverlay.
- better-auth 1.7.4 device-authorization plugin evaluated: no named/revocable/long-lived keys → hand-roll.
