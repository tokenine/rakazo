-- 004-code-mode Slice 5 (T30): Q6 budget and idle defaults per decision-s5-defaults.md.
-- Additive only: five new columns on coding_sessions; no existing columns altered,
-- renamed, or dropped.
--
-- Migration policy: NOT NULL DEFAULT is rejected by the additive migration gate
-- for ALTER ADD COLUMN (PostgreSQL stores defaults in the catalog without rewriting
-- existing rows, but the gate is conservative). Columns are added as nullable so
-- the ALTER is purely additive metadata. Defaults are enforced at the APPLICATION
-- level (Prisma schema @default + service-layer COALESCE).
--
-- idleThresholdMinutes: nullable; defaults to 30 in application code.
-- budgetMinutes: nullable; defaults to 120 in application code.
-- deadlineAt: nullable = no deadline.
-- activeRunMinutes: nullable; defaults to 0 in application code.
-- lastActivityAt: nullable; Prisma client sets to now() on create.
--
-- Protected path: additive-only migration. Flagged for independent review
-- before merge.

ALTER TABLE "coding_sessions" ADD COLUMN "idleThresholdMinutes" INTEGER;
ALTER TABLE "coding_sessions" ADD COLUMN "budgetMinutes" INTEGER;
ALTER TABLE "coding_sessions" ADD COLUMN "deadlineAt" TIMESTAMP(3);
ALTER TABLE "coding_sessions" ADD COLUMN "activeRunMinutes" INTEGER;
ALTER TABLE "coding_sessions" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
