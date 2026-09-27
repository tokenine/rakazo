# Risks and unknowns

Declared honestly so no atlas claim is mistaken for runtime proof.

## Stale / not generated yet

- **Runtime scenarios are code-verified, not live-verified** in this session. The telegram
  scenario was live-verified on 2026-09-27 per `docs/HANDOFF.md` §4; the agent-run
  scenario has not been replayed against a running stack here.
- **No C4 component/code views yet** — deliberately deferred until a feature needs one.
- **apps/desktop sandbox dir** (`infra/sandboxes/desktop/`) not inspected in the evidence pass.
- **Mobile auth path** marked inferred (same OTP + bearer endpoints assumed, not traced).
- **API↔worker symmetry** (API running jobs inline) is inferred from identical wiring, not proven.

## Unexamined boundaries (static analysis cannot see)

- Production traffic patterns, feature flags in server `.env`, deployment-specific overrides.
- Third-party behavior (Telegram rate limiting, hosted sandbox limits, LLM provider quotas).
- `executor.ts` is ~5,400 lines with no colocated unit test — behavior changes there rely on
  integration/e2e coverage; treat edits as high-risk.
- `router.ts` is ~5,700 lines; contract drift between it and `packages/contracts/src/rpc.ts`
  is only caught by typecheck.

## Known sharp edges (from docs/HANDOFF.md §6)

- Don't pipe-then-`&&` pnpm check/lint/test — masks exit codes.
- After any Prisma schema change: `pnpm --filter @rakazo/db generate`; migrations are plain
  SQL folders applied by the api container on boot.
- Biome formatter: run `npx biome check --write` after hand-edits.
- Rebrand/display assets live under `REBRAND-NOTES.md` + `scripts/rebrand-display.sh`.

## Confidentiality

No credentials, production identifiers, or customer data are stored in the atlas. Server
details from `docs/HANDOFF.md` (LAN addresses, SSH targets) are intentionally not copied here.
