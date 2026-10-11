# Acceptance — union retest + bug sweep, candidate 07007614 (2026-10-11)

## Scope delivered

- origin/main (29de238e, 48 commits) merged into the integration line as 63de6a99: clean
  auto-merge of 19 shared files; frozen install, prisma generate, typecheck 24/24 green.
- BUG-003-S1-06 closed (a2c2d19d): bundle endpoints must be public HTTPS; red 4/5 → green.
- Playwright slice retest (BUG-UNION-E2E-01 retest) surfaced three real product bugs, all
  fixed and committed: ef9f60c3 (background bot refresh yanked hub/marketplace into a chat —
  root-caused via history-instrumented probe to the unguarded route recovery in the
  bots-refresh handler), 6178785f (card Install click bubbled to the card, stacking the
  review modal on the detail drawer — the modal portal trapped all pointer events),
  492b1cec (card Install never selected the entry, so the review modal never mounted).
- e2e hardening: aaee2d0a (account trigger a11y name "You"; switcher stays open after
  delete; catalog wait; MARKETPLACE_IMPORT_SECRET documented), 00dc6b66 (exact chip
  selectors), 21090395 (legacy primary-thread route accepted), 9029a388 (send persistence
  wait before reload), 07007614 (rename lands before dialog dismissal).

## Acceptance evidence (independent QA clone at 07007614, isolated DB ss_bug_union_e2e_11)

Stack: api + worker from the clone, AGENT_RUNTIME=scripted, CLOUD_AGENT_PROVIDER=emulator,
EMAIL_EMULATOR=true, SANDBOX_PROVIDER=fake, WAKEUP_DRIVER=memory,
MARKETPLACE_IMPORT_SECRET set, compose Postgres on 5433, headless chromium.

- Slice sessions + marketplace + auth-lifecycle: 7 passed + 1 flaky (pass on retry), 0 failures.
- Unit suites on the same tip: typecheck 24/24, api 616 passed/1 skipped, contracts 108/108,
  web 358/358, adapters FAIL-set = the known macOS environmental set only (18 this round;
  the flaky T12 settle test passed) — zero new failures.

## Residual

- BUG-E2E-02 (open, low): sends intermittently time out under full-slice load; Playwright
  retries absorb it. Hypotheses + probes recorded in the bug artifact.
