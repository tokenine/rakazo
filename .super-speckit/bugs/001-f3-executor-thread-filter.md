# BUG-001-F3 — executor bot-directory query filters on removed 1:1 `thread` relation; runs stall in "Run setup failed; retrying" loop

- Status: `confirmed`
- Found in: `001-multi-session-agents / candidate f68d7bfb lineage (S1 residue); surfaced while verifying F-2 at 0d893595` — introduced by the S1 migration (Bot.thread 1:many) and missed by the T3 sweep
- Affected requirement: `R2` (runs must not stall per session/bot) + matrix row V8 (legacy compatibility); blocks all run-executing DB-gated suites (pi-offline, computer-approval, search, journeys, attachments, bot-secrets, executor-lifecycle, mention-targets)
- Severity: `high` (product code path: every run setup on a migrated schema errors until retry loop)
- Reproduction: `2/2` (PrismaClientValidationError on migrated schema; pi-offline passes at `ee119502^` with identical env/DB — A/B baseline rules out environment)

## Expected / actual

Expected: bot-directory query tolerates the 1:many `Bot.threads` relation after the multi-session migration.
Actual: `packages/adapters/src/executor.ts:3650` still filters `thread: { isNot: null }` (removed 1:1 relation) → Prisma runtime `Unknown argument 'thread'. Did you mean 'threads'?` → run setup fails and retries indefinitely.

## Minimal reproduction

1. Apply the full migration chain (multi-session schema).
2. Run any run-executing DB-gated suite after signup (needs BUG-001-F2 fix to reach this point).
3. Observe "Run setup failed; retrying" with PrismaClientValidationError in executor logs.

## Evidence

- Reporter: FixerF2 lane (found while verifying F-2 end-to-end)
- Why it slipped: offline typecheck carries 166 pre-existing TS errors (masking), and offline suites never execute this code path
- Sanitization completed: yes

## Fix and regression obligation

- Bug-fix worktree/commit: `ss/bug/001-f3` stacked on `ss/bug/001-f2` — pending; likely `threads: { some: {} }` (verify against intended semantics: bots with ≥1 session)
- Regression test: run-executing DB-gated suite reaching green run setup on migrated schema; plus extend the S1 residue sweep (grep for remaining singular `thread:` usages against the Bot model in where/include clauses)
- Independent retest run: pending (checker re-runs the stalled suites end-to-end on the stacked fixes)
