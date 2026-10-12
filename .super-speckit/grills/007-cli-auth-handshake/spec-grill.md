# Spec Grill: 007-cli-auth-handshake (2026-10-12)
1. better-auth device-authorization plugin? Evaluated against installed 1.7.4: issues short-lived
   device codes, not named revocable long-lived keys. Hand-roll CliToken; keep bearer interop.
2. How does a CLI token authenticate? One choke point: sessionHeaders/actor resolution in app.ts —
   unknown bearer → look up CliToken by SHA-256 hash → construct actor via requireMembership.
   No per-route changes (REQ-4 free).
3. Loopback delivery security: server POSTs token only to 127.0.0.1/::1 (desktop LOOPBACK_HOSTS set),
   with a one-time state nonce minted at begin; authorize page is session-authed; token shown once.
4. Deny/timeout UX? CLI polls its listener with a 5-minute deadline; deny → AUTH_FAILED exit 3;
   timeout → TIMEOUT exit 6; page closed → same as deny.
5. Revocation immediacy? Hash lookup on every request → revoked row fails closed immediately (REQ-5).
6. Hashed storage? SHA-256 of raw token; raw shown once at issuance; DB leak doesn't leak tokens.
7. Headless hosts (REQ-6)? --token fallback retained: authorize page shows the raw token once for
   manual paste; login --token path unchanged.
8. Does 006 block this? 006 has no pending maker work (awaiting maintainer release-gate decision);
   single writer proceeds on 007 in the same checkout.
