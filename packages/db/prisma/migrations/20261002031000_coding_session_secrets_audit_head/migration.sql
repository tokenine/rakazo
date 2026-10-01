-- 004-code-mode Slice 3 (T18): audit-chain head checkpoint on the run
-- record. Additive only: one nullable JSONB column; no existing column is
-- altered, renamed, or dropped. The verifier compares the recomputed JSONL
-- chain head against this checkpoint (wholesale-log-replacement detection).
-- Protected path: additive-only migration, flagged for independent review
-- before merge.

ALTER TABLE "coding_sessions" ADD COLUMN "secretsAuditHead" JSONB;
