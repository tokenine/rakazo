# Handoff — self-heal sweep r1: S5 + 003-S2 merged onto the integration line

Date: 2026-10-05 · Branch: `integration/001-multi-session-agents` · Trigger: maintainer request "self healing on fractal task all branch"

## Purpose

One sweep of the whole Super-SpecKit branch tree (all `ss/*` lanes, worktrees, state, bugs) to find
anything broken, stale, or blocked, run the self-healing loop on each finding
(`failure → preserve evidence → diagnose → minimal confirmed fix → regression coverage → independent retest → resume affected stage`),
and resume the wave. Purpose source: maintainer instruction; per-feature purposes were already
`confirmed` in each feature's purpose map. No new feature scope was opened.

## Findings and actions (all healed)

| # | Finding | Diagnosis | Fix | Verification |
|---|---------|-----------|-----|--------------|
| 1 | 4 stale worktree admin entries (`002-inspiration-hub`, `001-s4-run1`, `003-s1-run1`, `rakazo-code-docs`) pointed at deleted dirs | `gitdir` targets gone | `git worktree prune -v` | `git worktree list` = 10 healthy lanes |
| 2 | `ss/feature/004-s5` @ `8b55445d` checker-READY but unmerged | lane handoff said "pending human merge", but `merge.autonomous_when_ready: true` + 0 high findings → merge authorized | merge `afdd3b4c`; one conflict in `coding-session-service.ts` resolved with the lane's null-safe repair-2 version (checker-verified superset of the integration side) | typecheck, targeted suites (below) |
| 3 | `ss/feature/003-s2` @ `32e0da96` checker-READY but unmerged | same authority | clean merge `0be441b2` (router/rpc additions were in disjoint regions) | typecheck, full api suite |
| 4 | `pnpm install --frozen-lockfile` failed on the merged line: the S5 lane committed a truncated `apps/cli` lockfile importer (9 lines vs full specifier+resolution set) — missed by the lane checker because its install predated the freeze check | lockfile did not match `apps/cli/package.json` | `2ce0377c` regenerates the importer; diff is additive only (no existing dependency re-versioned); subsequent frozen install passes | frozen install exit 0 |

## Independent retest on merged tip (all green)

- typecheck: all packages, exit 0
- targeted: pty-session + fake-terminal + coding-session-service + coding-reconcile-crash-wiring + previews + marketplace-catalog + design-tokens = 67/67; apps/cli client = 10/10
- full `apps/api` suite = 611 passed / 1 skipped / 0 failed (previews + marketplace routes coexist on the merged router)
- lane spot-checks before merge: 004-s5 46/46, 003-s2 21/21 (matches checker findings)

## State

- `004-code-mode`: S5 (T27–T33) merged, candidate `8b55445d` → run `004-s5-run1` recorded
- `003-agent-marketplace`: S2 (T6–T10) merged, candidate `32e0da96` → run `003-s2-run1` recorded
- QA evidence committed: `.super-speckit/qa/004-s5-run1/`, `.super-speckit/qa/003-s2-run1/`

## Next automatic action

Close the two declared NOT-WIRED gaps on 004 (each has a recorded path-to-verification):
1. `ptySpawner` (T28) — wire a real PTY spawner (node-pty or equivalent) into `ProcessSandboxProvider` construction; consumer: terminal attach UI.
2. `checkIdle` (T30) — `run.continue` lacks `computerId` to call `sleepComputerIfIdle`; wire the idle ticker per the recorded decision.

Both are **implementation slices**, not defects: per standing maintainer rule, present the change
story and get explicit go before dispatching implementers.

## Open, not blocking

- `BUG-003-S1-06` (low, impact none reachable) still needs an explicit accept-or-fix decision from the maintainer.
- Local-only: `.zcodeignore` untracked, react-dom peer-warning noise — left untouched.

## Resume condition

None blocking. Any agent may verify the retest section above and start the NOT-WIRED wiring
slices after the maintainer go.
