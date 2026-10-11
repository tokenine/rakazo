# BUG-UNION-E2E-01 — e2e onboarding helper stalls on the "Connect a model" step

- Status: `fixed and retested` (2026-10-11)
- Found in: integration line web e2e slice run against the merged stack (candidate 2eb3d19d lineage)
- Severity: `high` for release confidence (whole sessions/marketplace/auth e2e battery is dead on this line), not a product defect
- Found by: coordinator running the playwright gate during 004-s6-run1 proof

## Root cause

Commit `1f166822` (union Dome mainline into the integration line) landed AFTER the last green
e2e evidence (`001-s2-run1`, e2e 3/3) and brought an onboarding "Connect a model" step
(Provider/Model/API key + disabled Continue). `apps/web/e2e/helpers.ts::completeOnboarding`
predates that step: it waits for "Server integrations" / "Chief" / "Opening chat…" only, so
signup-driven specs time out at 20 s on the model step.

Pre-existing relative to 004 S6: S6's diff (924da3ba..2eb3d19d) touches only
packages/adapters + apps/api/src/app.ts + apps/worker + matrix docs — no web files; ancestry
check shows the union merge postdates the last green run.

## Evidence

- Page snapshot (error-context.md): heading "Connect a model", Provider=OpenRouter, Model
  preset, API key empty, Continue disabled.
- Dev stack log during the window: signup + OTP emulator + RPC all 200; no 5xx.
- Differential: ancestry (1f166822 not ancestor of 3d99186f) + S6 diff scope.

## Fix

`completeOnboarding` handles the model step the same way it skips integrations: when the
"Connect a model" heading is visible, fill the API key with the established fake-key pattern
(`fake-integration-key` per local-settings.spec.ts) and click Continue, then resume the
existing Chief-wait flow.

## Regression

The playwright slice (sessions + marketplace + auth-lifecycle) going green on the merged
stack is the retest; CI's full playwright suite covers the rest on push.

## Retest (2026-10-11, after the main union 63de6a99 and follow-up fixes)

The slice runs green end-to-end on candidate 07007614 against a full local scripted
stack (AGENT_RUNTIME=scripted, CLOUD_AGENT_PROVIDER=emulator, EMAIL_EMULATOR=true,
SANDBOX_PROVIDER=fake, MARKETPLACE_IMPORT_SECRET set, api + worker): 7 passed + 1 flaky
pass-on-retry (`sessions` resume), 0 failures. Reaching that uncovered three real product
bugs, fixed in `ef9f60c3` (background bot refresh yanked hub/marketplace into a chat),
`6178785f` (card Install stacked the review modal on the detail drawer, trapping the
pointer), `492b1cec` (card Install never selected the entry, so the review modal did not
mount), plus the account-trigger a11y name in `aaee2d0a`. Residual: sends intermittently
time out under slice load — tracked in `send-timeout-under-slice-load.md`.
