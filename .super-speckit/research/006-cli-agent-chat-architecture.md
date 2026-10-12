# Architecture contract: 006-cli-agent-chat
- Dependency direction: apps/cli → @rakazo/contracts (+ zod). No new deps except none needed; remove unused @orpc/client if touched.
- One output path: shared emit() helper = only writer of stdout JSON/diagnostics + exit codes; every command routes through it (tokens never printed).
- One credential store: ~/.config/rakazo/credentials.json (0600), env overrides RAKAZO_TOKEN/RAKAZO_BASE_URL/RAKAZO_SPACE_ID; no second config source.
- Server untouched: CLI is a thin client over existing /rpc procedures; any needed endpoint is a spec amendment first.
- Enforcement: package lint/biome + vitest boundaries; forbidden example — a command printing raw errors with tokens, or writing config outside the credentials file, fails review checklist and tests.
- Valid path proven by: existing client.test.ts suite green + new command-layer tests (T1–T3).
