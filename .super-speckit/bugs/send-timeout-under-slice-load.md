# BUG-E2E-02 — intermittent send/composer timeouts in full e2e slice runs

- Status: `open — investigation` (2026-10-11)
- Severity: `low` (test-robustness / possible runtime behavior; CI gate unaffected so far)
- Found in: local scripted-stack runs of the sessions + marketplace + auth-lifecycle slice on the integration line (candidates a2c2d9be..07007614), ~8 runs

## Shape

In full-slice runs (not solo runs), one or two sends intermittently fail: the composer
never clears because `threads.send` either rejects or does not resolve within the test's
20s window. Playwright reports the test flaky (passes on retry). Individually, the same
tests pass in seconds. Playwright's standard `--retries` absorbs it today.

## Evidence

- api HTTP layer is not the bottleneck: slowest request in a failing window was ~2.8s.
- The run table shows heavy multiplication under the scripted runtime: 457 completed runs
  for ~8 test users in one isolated DB, and a lingering `running` run (which also blocks
  that session's deletion per grill #5).
- Leading hypothesis (unchecked): `threads.send` rejects via the `modelSetup.needsModel`
  gate ("Connect a model to start a run", router.ts ~2206) for users whose onboarding
  fake-key credential is treated as missing, or the send conflicts with the prior
  message's still-active run under churn. Neither path has been reproduced directly.

## Next probes

1. Capture the failing send's RPC response body (page.on('response') on /rpc/*) in a
   full-slice run and read the actual error.
2. Explain the run multiplication under the scripted runtime (bot replies starting new
   runs?) — if real in production runtimes too, that is its own defect.
3. If the gate is at fault, decide whether onboarding's fake-key credential should count
   as a connected model in scripted mode.
