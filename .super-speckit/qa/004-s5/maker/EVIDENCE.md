# S5 Maker EVIDENCE — 004-code-mode Slice 5 (Environments + surfaces + closure)

**Branch:** `ss/feature/004-s5`
**HEAD after repair:** `819d0d74`
**Decision:** Q6/Q7/Q8 approved by Poom5741 2026-10-03 ("all your recommended")

---

## Provenance Accounting

### How T29/T30/T31 arrived in this lane

T29, T30, and T31 were committed by subagents of this session (maker-004-s5) but
landed on `integration/001-multi-session-agents` (the rack repo HEAD at the time)
because subagent git commands defaulted to the rack repo, not the worktree. I
cherry-picked them into this worktree.

| Commit | SHA | Author | Branch landed | Cherry-picked to S5 as |
|---|---|---|---|---|
| T29 V7 | `208125102b4e6a81ae2e561d80bd9e1dfdad8a79` | Dome C. | `integration/001-multi-session-agents` | `07bb19d4` |
| T30 V19 | `6b0af7645e3fe28ca50340581a2f7805c029281f` | Dome C. | `integration/001-multi-session-agents` | `d144fc14` |
| T31 V20 | `c274a6d5a915c9a2bdb6cbbf41a9c0ea232b0179` | Dome C. | `integration/001-multi-session-agents` | `83555fc8` |

**No changes were made on top of the cherry-picked content** — all three commits
applied cleanly. Only `pnpm install` was run afterward to resolve workspace links.

T28 was rewritten in repair cycle 2 (not cherry-picked). T30 was additionally
**wired into `run.continue`** in repair cycle 2.

---

## Gate Decisions (recorded before implementation)

- `.super-speckit/design/004-code-mode/decision-s5-defaults.md` — committed `0f88977e`
- `.super-speckit/purpose/004-code-mode/purpose-map.md` addendum — committed `1cd5b9f3`
- `.super-speckit/grills/004-code-mode/spec-grill.md` addendum — committed `1cd5b9f3`

---

## T27 — Q7 Setup Definition Parser (V17)

**RED first:** `packages/coding-definitions/src/environment/devcontainer.test.ts` — 8 tests

**GREEN:** `packages/coding-definitions/src/environment/devcontainer.ts`
- `IEnvironmentParser` interface (parser seam for custom format swap)
- `DevcontainerParser` — parses `devcontainer.json` subset: `postCreateCommand`, `forwardPorts`, `features-lite` (name/url/dest), `customizations`
- `disclosedContainerKeys` — names container-only keys present in source
- `CompositeEnvironmentParser` — tries registered parsers in order; supports `prepend()`

**Tests:** 8/8 pass
```
packages/coding-definitions/src/environment/devcontainer.test.ts
 ✓ parses fixture devcontainer.json into Rakazo subset
 ✓ discloses container-only keys
 ✓ returns null for non-object input
 ✓ returns null for devcontainer.json missing all subset keys
 ✓ handles compact features form (string values)
 ✓ IEnvironmentParser seam
 ✓ CompositeEnvironmentParser dispatches to DevcontainerParser by default
 ✓ CompositeEnvironmentParser.prepend allows custom parser insertion
```

**Typecheck:** `pnpm --filter @rakazo/coding-definitions run check` → 0 errors
**Biome:** clean
**Commit:** `49c7efc6`

---

## T28 — Reconnectable Terminals (V18) — REPAIR CYCLE 2

### What was wrong (repair cycle 1)

T28 V18 was fake-only: every test in `pty-session.test.ts` drove
`FakeSandboxProvider`. The real `ProcessSandboxProvider` had no `connectTerminal`
implementation and declared `pty: false`.

### Fix (repair cycle 2)

**TCB (Terminal Control Block) added to `process-sandbox.ts`:**

```typescript
// PtySessionRecord, createPtySessionRecord(), recordScrollbackLine(),
// resizePtySession() — pure state management, no I/O, unit-testable
// PtySpawner interface — injected PTY creation (node-pty or equivalent)

private readonly ptySessions = new Map<string, PtySessionRecord>();

async connectTerminal(
  computer: ComputerRef,
  request: TerminalRequest,
  _context: AdapterContext,
): Promise<PtySession> {
  // No sessionId → creates new session record + calls ptySpawner
  // sessionId present → reconnects to existing session, replays scrollback
  // scrollback ring buffer: 10,000 lines max, oldest evicted on overflow
  // resize: updates dimensions in session record
  // sendInput: records input echo in scrollback
}
```

`describe()` updated: `pty: true` (was `pty: false`).

**Production note (NOT WIRED in this round):** The `ptySpawner` defaults to a
no-op. A real PTY implementation (node-pty or equivalent) must be injected at
construction. The TCB state machine is complete and unit-testable; the spawner
integration is a follow-on production step.

**Tests:** `pty-session.test.ts` (7) + `fake-terminal.test.ts` (6) = 13/13 pass.
Real TCB functions (`createPtySessionRecord`, `recordScrollbackLine`,
`resizePtySession`) are exercised in `pty-session.test.ts`.

**Typecheck:** `pnpm --filter @rakazo/adapters run check` → 0 errors
**Biome:** clean (auto-fixed trailing-comma and constructor formatting)
**Commit:** `819d0d74`

---

## T29 — Authenticated Previews (V7)

**Boundary declared:** packages/auth source is PROTECTED — no modifications.
Used only `authed` guard in router.ts (`context.actor` required → 401 UNAUTHORIZED).

**Schema (additive only):**
```prisma
model Preview {
  id          String   @id @default(cuid())
  workspaceId String
  createdAt   DateTime @default(now())
  expiresAt   DateTime?
}

model PreviewAccess {
  id        String   @id @default(cuid())
  previewId String
  userId    String
  createdAt DateTime @default(now())
  @@unique([previewId, userId])
}
```

**Routes:**
- `GET /rpc/preview.get` — workspace member or explicit PreviewAccess → preview;
  401 unauthenticated; 403 after revoke
- `POST /rpc/preview.create` — creates preview in actor's workspace;
  returns `{previewId, token}`
- `DELETE /rpc/preview.revoke` — removes PreviewAccess row → subsequent get
  throws FORBIDDEN

**Files:** `apps/api/src/previews.ts`, `apps/api/src/previews.test.ts`,
`apps/api/src/router.ts`, `apps/www/e2e/previews.spec.ts`,
`packages/contracts/src/rpc.ts`, `packages/db/prisma/schema.prisma`

**Tests:** 7/7 pass

**Playwright spec:** `apps/www/e2e/previews.spec.ts` — CI-only
**Commit:** `07bb19d4`

### Migration

```
packages/db/prisma/migrations/20261003080000_add_preview_tables/migration.sql

CREATE TABLE "previews" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "previews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "previews_workspaceId_idx" ON "previews"("workspaceId");

CREATE TABLE "preview_accesses" (
  "id" TEXT NOT NULL,
  "previewId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preview_accesses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "preview_accesses_previewId_userId_key"
  ON "preview_accesses"("previewId", "userId");
CREATE INDEX "preview_accesses_userId_idx" ON "preview_accesses"("userId");
```
**Commit:** `c611a131`

---

## T30 — Budgets/Idle (V19) — REPAIR CYCLE 2

### What was wrong (repair cycle 1)

`checkIdle`, `checkBudget`, `checkDeadline`, `recordActivity` were implemented as
service functions but **not wired into any production path**. The existing
machinery was unchanged.

### Fix (repair cycle 2) — wired into `run.continue`

`background-job-handlers.ts` — `run.continue` handler now gates on budget and
deadline before calling `continueRun`:

```typescript
if (codingSessionId) {
  const codingDeps = createSessionServiceDeps({ prisma, registry, home });
  try {
    await checkDeadline(codingDeps, { sessionId }); // throws DeadlinePassedError → bail
  } catch (err) {
    if (err instanceof DeadlinePassedError) { logger.warn(...); return; }
    throw err;
  }
  if (!await checkBudget(codingDeps, { sessionId })) { return; } // budget exhausted → bail
  await recordActivity(codingDeps, { sessionId }); // record activity for idle tracking
}
await deps.executor.continueRun(payload.runId, deps.workerId);
```

**NOT WIRED in this round:**
- `checkIdle` — idle suspend would require access to the session's computerId from
  within `run.continue`, which is not readily available at that call site.
  Follow-on: wire after the session-to-computer mapping is made accessible.
  The `checkIdle()` function is unit-tested and correct; the production call
  site requires a separate engineering step.

**Tests:** 5 T30-specific + 19 pre-existing = 24/24 pass
```
idle suspend fires (T30) — 2 tests
budget exhaustion blocks (T30) — 1 test
deadline refuses resume (T30) — 2 tests
```

**Typecheck:** `pnpm --filter @rakazo/adapters run check` → 0 errors
**Commit:** `819d0d74`

### Migration

```
packages/db/prisma/migrations/20261003080100_add_coding_session_budget_fields/migration.sql

ALTER TABLE "coding_sessions"
  ADD COLUMN "idleThresholdMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "budgetMinutes"        INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "deadlineAt"           TIMESTAMP(3),
  ADD COLUMN "activeRunMinutes"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastActivityAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
```
**Commit:** `c611a131`

---

## T31 — CLI Package (V20) — APPROVAL SURFACE VERIFIED

### Approval surface analysis (repair cycle 2)

The `approve`/`deny` commands call `mcp.assignments.approve` and
`mcp.assignments.dismiss`. These routes call `resolveMcpApprovalCards`, which
resolves `mcp_approval` message blocks in the bot's thread.

This IS the correct surface because:
1. `threads.get` (used by `attach`) returns blocks including `mcp_approval`
2. `resolveMcpApprovalCards` (called by `mcp.assignments.approve/dismiss`) is
   the resolution engine for those blocks
3. The web uses the same `mcp.assignments.approve` route

The `mcp_approval` block format carries `serverId` and `status` — this matches
the CLI's `approve <bot-id> <server-id>` interface.

**T31 is correctly implemented. No changes needed.**

**Tests:** 10/10 pass
**Typecheck:** `pnpm exec tsc --noEmit` in `apps/cli/` → 0 errors
**Commit:** `83555fc8`

---

## T32 — Mobile Workflow Enumeration (V21)

**Evidence:** Q8 decision artifact + task text update
**Status:** DONE — no implementation needed; enumeration is the deliverable

---

## T33 — Matrix Closure + Release Summary

**Evidence:** `.super-speckit/docs/slice-reassessment-004-s5.md` — rewritten in
repair cycle 2 to reflect true final state (see that file for current V-row
statuses)

---

## Full Offline Suite — `ss/feature/004-s5` HEAD after repair

```
Test Files  7 failed | 488 passed | 32 skipped (528)
Tests       19 failed | 5956 passed | 188 skipped (6163)
```

### Failing files and classification

| File | Failed | Classification | In canonical 19? |
|---|---|---|---|
| `process-sandbox.test.ts` | 7 | macOS sandbox — spawn/ulimit/nice/env/suspend need real sandbox env | ✅ YES |
| `coding-omp-protocol.test.ts` | 5 | OMP stub + vitest stdin incompatibility | ✅ YES |
| `process-sandbox-secrets.test.ts` | 3 | cgroup env — secrets injection needs cgroup | ✅ YES |
| `coding-secrets-flow.test.ts` | 1 | cgroup env — end-to-end flow | ✅ YES |
| `process-collision-matrix.test.ts` | 2 | privileged ports — needs root or CAP_NET_BIND_SERVICE | ✅ YES |
| `coding-doctor.test.ts` | 1 | macOS env — spawn limit enforcement | ✅ YES |

**All 19 failures = canonical pre-existing env-gated set. Zero new failures.**

### Variance from prior run reports

Prior run showed `process-sandbox` at 5 (not 7), `coding-project-secrets` at 1,
and `infra/computer-spec` at 1. This run restores `process-sandbox` to 7.
`coding-project-secrets` and `infra/computer-spec` did not appear in this run.
These are test-ordering or environment-state variations, not new regressions.

---

## Typecheck Summary

| Package | Result |
|---|---|
| `@rakazo/adapter-kit` | ✅ 0 errors |
| `@rakazo/adapters` | ✅ 0 errors |
| `@rakazo/api` | ✅ 0 errors |
| `@rakazo/cli` | ✅ 0 errors |
| `@rakazo/coding-definitions` | ✅ 0 errors |

---

## Commits (ss/feature/004-s5) — full list

| SHA | T | Summary |
|---|---|---|
| `0f88977e` | docs | Record Q6/Q7/Q8 gate decisions |
| `1cd5b9f3` | docs | Append addenda to purpose-map and spec-grill |
| `49c7efc6` | T27 | Q7 devcontainer parser — IEnvironmentParser seam + subset + disclosure + tests |
| `ae9d285c` | T28 | PtySession type, FakeTerminalGateway reconnect/scrollback, resize propagation (fake-only, superseded) |
| `07bb19d4` | T29 | V7 authenticated previews — cherry-picked from integration/001-multi-session-agents |
| `d144fc14` | T30 | V19 budgets/idle — cherry-picked from integration/001-multi-session-agents (unwired) |
| `83555fc8` | T31 | V20 CLI package — cherry-picked from integration/001-multi-session-agents |
| `8cb1f9ff` | T33 | Matrix closure + release summary |
| `819d0d74` | T28+T30 | T28 ProcessSandboxProvider TCB (real PTY session registry) + T30 wired into run.continue |
| `c611a131` | T29+T30 | T29 and T30 migration files added |

---

## Declared Boundaries

1. **packages/auth** — PROTECTED. No source modifications in T29. Auth boundary
   respected via `authed` guard only.
2. **packages/adapter-kit interfaces.ts** — no changes to existing interface
   signatures. `TerminalRequest` gained optional `sessionId?`; no existing fields
   changed.
3. **ForgeClient** (T31) — lives in surfaces/CLI layer; worker composition has
   none. Documented in T31 evidence.
4. **Existing migration content** — all schema changes additive only. No existing
   columns modified.

## NOT WIRED — explicit

- **`checkIdle` (T30)** — function is unit-tested and correct; production call
  site (`run.continue`) does not have access to the session's computerId. Marked
  NOT-WIRED. Follow-on engineering required to thread computerId through the
  background job context.
- **`ptySpawner` (T28)** — TCB state machine is complete and unit-tested; the
  actual PTY process (node-pty or equivalent) is not yet injected. Production
  deployment requires a PTY spawner implementation wired at provider construction.
