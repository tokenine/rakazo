-- 004-code-mode Slice 5 (T30): Q6 budget and idle defaults per decision-s5-defaults.md.
-- Additive only: five new nullable/DEFAULT columns on coding_sessions; no existing
-- columns altered, renamed, or dropped.
--
-- idleThresholdMinutes: session is idle-suspendable when (no active run AND
--   now - lastActivityAt > idleThresholdMinutes). Default: 30 min.
-- budgetMinutes: per-task active-run budget in minutes; run steps are blocked
--   once activeRunMinutes >= budgetMinutes and the run is unattended. Default: 120 min.
-- deadlineAt: wall-clock deadline from task start; null = no deadline.
-- activeRunMinutes: cumulative wall-clock minutes of active run time; updated
--   by recordActivity() on every run step tick.
-- lastActivityAt: timestamp of the last user or agent interaction; reset by
--   recordActivity() and read by checkIdle().
--
-- Protected path: additive-only migration. Flagged for independent review
-- before merge.

ALTER TABLE "coding_sessions" ADD COLUMN "idleThresholdMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "coding_sessions" ADD COLUMN "budgetMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "coding_sessions" ADD COLUMN "deadlineAt" TIMESTAMP(3);
ALTER TABLE "coding_sessions" ADD COLUMN "activeRunMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "coding_sessions" ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
