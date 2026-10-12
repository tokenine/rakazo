# BUG-004-S7-01 — second coding-session start returns 500 instead of the busy 409

- Status: `confirmed` (2026-10-11, browser walkthrough of the S7 slice on candidate `ce63ceaf`)
- Severity: `medium` (user-facing error is "Internal server error" instead of the clear busy message)
- Found by: interactive review — started "Fix login bug" (normal-pi) on a bot, then a second coding session on the same bot

## Evidence

- First create succeeded (strip shows "Fix login bug · normal-pi · active").
- Second create: composer showed "Internal server error"; api log
  (`/tmp/review-api2.log` 07:39:22Z) logs `codingSessions/create failed` with a raw
  `PrismaClientKnownRequestError` from `tx.codingWorkspaceLease.findUnique()`
  (coding-session-service.ts:199) — i.e. the busy path's catch-and-takeover ran
  `findUnique` in the same interactive transaction right after the P2002, which
  Postgres rejects once the transaction is aborted.
- The unit fake in `apps/api/src/coding-sessions.test.ts` emulates the unique
  violation but not real transaction semantics, so the slice's tests stayed green.

## Fix direction (next repair lane)

In the adapters lease-claim path, run the takeover/read in a fresh query (or check
existence outside the aborted transaction / use a separate transaction or raw query)
so `WorkspaceBusyError` is raised properly; then the router maps it to 409 and the UI
shows the clear busy message. Add a real-Postgres regression in
`coding-session.postgres.test.ts` covering claim-while-held through the service.
