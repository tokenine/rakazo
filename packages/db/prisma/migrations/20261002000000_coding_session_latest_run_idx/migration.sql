-- 004-code-mode S1 fix round (LOW-3): the acceptance gate resolves coding
-- sessions by latestRunId on every gated tool call (coding-acceptance-gate.ts),
-- so the column gets its own index. Additive only: a single CREATE INDEX on
-- the coding_sessions table created by 20261001050500_coding_sessions_lease.
-- No existing table, column, or migration is altered.

CREATE INDEX "coding_sessions_latestRunId_idx" ON "coding_sessions"("latestRunId");
