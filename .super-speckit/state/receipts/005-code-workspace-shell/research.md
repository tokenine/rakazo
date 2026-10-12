# Research receipt — 005-code-workspace-shell (slice 7 of 004-code-mode)

Investigator brief 2026-10-11 (session, two read-only sweeps with file:line evidence, mirrored in
.super-speckit/grills/005-code-workspace-shell/spec-grill.md "Investigator"):

- Terminal stack: xterm.js LiveTerminal ⇄ binary WS ⇄ node-pty `bash --norc`
  (packages/adapters/src/node-pty-spawner.ts, process-sandbox.ts connectTerminal); reconnect never
  re-spawns; scrollback replay + resize shipped S5/S6 (V18 green).
- Lease model: hasActiveComputerControl (packages/adapters/src/computer-control.ts), computer-row
  lease fields; terminalUrl gated FORBIDDEN "Take control first." (apps/api/src/router.ts).
- withViewOnly sets a query param only; enforcement point chosen provider-side (kind-0 drop).
- Env: scrubProcessEnv positive allowlist (process-env-scrub.ts); secrets only via applySecretGrant
  audited channel — launch path stays scrubbed.
- Routing: declarative React Router (apps/web/src/App.tsx); full-page precedent ArtifactsPage.
- Files/git: listFiles/readFile exist path-contained on ProcessSandboxProvider; no git integration —
  CommandRunner subprocess seam (coding-repo-to-pr.ts).
- Unknowns carried: WS relay hop for provider-internal /pty URL untraced (must respect view-only
  when it lands); production headless spawnOmp still a stub (out of slice scope).
