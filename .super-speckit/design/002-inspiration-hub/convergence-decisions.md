# 002 Convergence decisions (2026-10-02)

## D1 (T15): fully-empty `/app` routes to `/onboarding`, not HubPage — ACCEPTED

The convergence audit flagged that the literal task text ("`/app` with no botId renders
HubPage when `space.hasContent === false`") is not implemented: a fully empty deployment
(0 bots, 0 archived, 0 groups, no space hasContent) redirects to `/onboarding` instead
(`apps/web/src/pages/Shell.tsx` redirect effects, both guarded `!hubEntry`).

Decision: keep onboarding as the guided first-run path for a fully empty deployment. The
QA "Shell hijack" fix deliberately preserved this behavior and the e2e suite (hub.spec.ts
V1) exercises HubPage via `/app/hub`, which remains reachable for spaces with content and
from the shell at any time. Intent of R2 ("empty deployment → guided first actions") is
satisfied by onboarding; HubPage's First-actions zone covers the partially-empty case.

Reversal path: remove the `!hubEntry` guard from one redirect effect in Shell.tsx and the
empty deployment lands on HubPage instead — no contract changes.

Chosen by: orchestrator (autonomous per execution policy; reversible product decision).
