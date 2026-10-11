# Final manual review log — union + bug-sweep delivery

- Candidate: `be50db02` (integration/001-multi-session-agents tip)
- Environment: local stack from the main checkout — api + worker + web dev servers, compose Postgres (5433), fresh database `ss_manual_review`, AGENT_RUNTIME=scripted, CLOUD_AGENT_PROVIDER=emulator, EMAIL_EMULATOR=true, SANDBOX_PROVIDER=fake, MARKETPLACE_IMPORT_SECRET set. Reviewer drives the real UI via the in-app browser; OTP codes read from the dev emulator inbox.
- Route: env receipt → primary journey (signup→onboarding→chat) → marketplace/install regressions → persistence → auth boundary → sessions switcher → narrow viewport/keyboard → summary.

| # | Step | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Environment: fresh DB `ss_manual_review`, scripted runtime stack, candidate `be50db02` | Stack up, api+worker+web 200 | As expected | pass | /tmp/review-{api,worker,web}.log |
| 2 | Primary journey: signup (OTP via emulator) → onboarding → first bot | Land in Chief chat at /app/:botId with greeting card + composer | /app/cmv3heljd000jjh7jinpi30n1, choice card rendered, account button announces "You" (a11y fix live) | pass | review screenshots (in-session) |
| 3a | Marketplace browse: /app/marketplace | 4 bundled cards render; page stays on marketplace (yank fix ef9f60c3) | URL held /app/marketplace across greeting events; catalog rendered | pass | review screenshots |
| 3b | Card Install → review modal (stacked-dialog fixes 6178785f/492b1cec) | ONLY "Review Install" dialog; Confirm installs; agent appears in sidebar | Single dialog; confirm installed "Coder" into the roster; no drawer beneath | pass | review screenshots |
| 4 | Persistence: send message to Chief, reload | Message visible before + after reload; scripted reply arrives | "manual review persistence check" persisted; Chief replied "done. i handled: …" | pass | review screenshots |
| 5 | Auth boundary: account menu (a11y "You") → Log out → protected deep link → OTP re-login | Menu opens by name "You"; logout → /sign-in; deep link redirects; re-login restores bot route | All as expected | pass | review screenshots |
| 6 | Sessions switcher: create → rename → delete | New session routes to /app/:bot/:thread; rename visible; delete removes row, switcher STAYS OPEN showing Primary; URL falls back to primary | All as expected (stays-open fix aaee2d0a verified live) | pass | review screenshots |
| 7 | Narrow viewport (390x844) + keyboard-only input | Layout adapts; composer accepts keyboard text | Mobile layout collapses sidebar, transcript flows, composer intact; typing works | pass | review screenshots |
| 8 | Summary | — | See below | — | — |

## Summary (2026-10-11, candidate be50db02)

- **Verified**: environment/reset, primary journey (signup→OTP→onboarding→Chief chat), scripted run pipeline (reply landed), marketplace browse + card-install flow (all three fixed product bugs behave correctly live), Skills-filter empty state, persistence across reload, auth boundary (logout, protected deep link, OTP re-login), sessions switcher create/rename/delete with stays-open behavior, account menu a11y name "You", narrow viewport, keyboard input.
- **Failed**: none.
- **Blocked**: none.
- **Unverified / notes**: (1) the "Connect a model" onboarding step did not appear for this deployment (model step auto-skipped — covered by the automated onboarding specs instead); (2) IAB automation quirks (stale frames, hover-revealed actions needing coordinate clicks) cost time but are not product defects; (3) BUG-E2E-02 (send timeouts under slice load) was not reproducible in interactive single-user review — it remains open for the automated-slice context.
- Reviewer environment note: the checkout `.env` was temporarily pointed at `ss_manual_review` and has been restored from backup after the review.

**Verdict: PASS — no new defects found in the delivered candidate.**
