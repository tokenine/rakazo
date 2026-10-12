# Plan: 007-cli-auth-handshake

## Architecture constraints
- Server owns issuance, storage (hashed), revocation, and auth resolution; CLI stays a thin client.
- One auth choke point: actor resolution in apps/api/src/app.ts accepts bearer session OR CliToken
  hash → same Actor shape. No per-route auth branching.
- New DB model CliToken {id, userId, name, tokenHash unique, createdAt, lastUsedAt, revokedAt};
  SHA-256 only; raw token never stored or logged.
- New surface: GET /cli/authorize (session-authed HTML page), POST /cli/authorize/deliver
  (one-time state → loopback delivery), rpc.cliTokens.list/revoke (settings UI).
- Delivery only to loopback hosts (desktop LOOPBACK_HOSTS set) with one-time state nonce.
- CLI: login (listener + browser open + fallback URL print), credential store unchanged.

## Tasks (TDD each)
1. Server: CliToken migration + hash helpers + actor resolution acceptance test (red: bearer-less
   CLI token authenticates; revoked token 401s).
2. Server: authorize page + begin/state + deliver-to-loopback; rpc.cliTokens.list/revoke + contract
   tests (red: revoke kills access on next request).
3. Web: settings panel listing CLI tokens with name/created/last-used/revoke (mirrors models list).
4. CLI: login handshake (listener, browser open via `open`/`xdg-open`, printed URL fallback,
   deny→3, timeout→6, 0600 store) + tests with fake fetch/listener.
5. Packaging unchanged; npm-global smoke re-run.
6. QA on ai7: full acceptance walk (login→allow→chat→revoke→AUTH_FAILED; deny path; headless
   fallback). Journey + independent review per contract.
