# S5 Maker EVIDENCE — 004-code-mode Slice 5 (Environments + surfaces + closure)

**Branch:** `ss/feature/004-s5`
**HEAD:** `83555fc8`
**Decision:** Q6/Q7/Q8 approved by Poom5741 2026-10-03 ("all your recommended")

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

## T28 — Reconnectable Terminals (V18)

**RED first:** `packages/adapters/src/pty-session.test.ts` — 7 tests

**GREEN:** `packages/adapters/src/fake-terminal.ts` + `packages/adapters/src/fake-sandbox.ts` + `packages/adapter-kit/src/types.ts`
- `TerminalRequest.sessionId?: string` — reconnect to existing session
- `PtySession` interface — `sessionId`, `url`, `scrollback: string[]`, `resize()`, `sendInput()`, `cols`, `rows`
- `FakeTerminalGateway` extended: `attach(sessionId)` returns scrollback; `recordScrollback()` tracks output; `resize()` updates dimensions; `start()` made public; `sessions` made readonly
- `FakeShell` extended: `onResize` callback fires when terminal resizes
- `FakeSandboxProvider.connectTerminal`: reconnects with same sessionId → replays scrollback; new sessionId → creates with that id; `buildPtySession()` returns live cols/rows via getters

**Existing tests updated:** `packages/adapters/src/fake-terminal.test.ts` — `result.url` instead of `await gateway.open()`

**Tests:** 13/13 pass
```
packages/adapters/src/fake-terminal.test.ts — 6/6 (unchanged)
packages/adapters/src/pty-session.test.ts — 7/7
 ✓ FakeSandboxProvider declares pty: true
 ✓ connectTerminal accepts cwd and returns sessionId
 ✓ reconnect replays scrollback
 ✓ resize propagates to cols/rows
 ✓ sendInput round-trips
 ✓ different sessionId creates new session
 ✓ attach returns session with scrollback
```

**Typecheck:** `pnpm --filter @rakazo/adapters run check` → 0 errors
**Typecheck:** `pnpm --filter @rakazo/adapter-kit run check` → 0 errors
**Biome:** clean
**Commits:** `ae9d285c`

---

## T29 — Authenticated Previews (V7)

**Boundary declared:** packages/auth source is PROTECTED — no modifications. Used only `authed` guard in router.ts (`context.actor` required → 401 UNAUTHORIZED).

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
- `GET /rpc/preview.get` — workspace member or explicit PreviewAccess → preview; 401 unauthenticated; 403 after revoke
- `POST /rpc/preview.create` — creates preview in actor's workspace; returns `{previewId, token}`
- `DELETE /rpc/preview.revoke` — removes PreviewAccess row → subsequent get throws FORBIDDEN

**Files:** `apps/api/src/previews.ts`, `apps/api/src/previews.test.ts`, `apps/api/src/router.ts`, `apps/www/e2e/previews.spec.ts`, `packages/contracts/src/rpc.ts`, `packages/db/prisma/schema.prisma`

**Tests:** 7/7 pass
```
apps/api/src/previews.test.ts
 ✓ create returns a previewId and token
 ✓ get returns preview when actor is workspace member
 ✓ get throws FORBIDDEN when actor has no access
 ✓ revoke removes access → subsequent get throws FORBIDDEN
 ✓ grantAccess calls previewAccess.upsert
 ✓ get returns null for nonexistent preview
 ✓ auth boundary returns 401 when no actor
```

**Playwright spec:** `apps/www/e2e/previews.spec.ts` — validates in CI (not run locally)
**Commit:** `07bb19d4` (cherry-picked from subagent `208125102b4e6a81ae2e561d80bd9e1dfdad8a79`)

---

## T30 — Budgets/Idle (V19)

**Q6 defaults per decision-s5-defaults.md:**
- `idleThresholdMinutes`: 30 (no active run + no interaction → suspend)
- `budgetMinutes`: 120 (per-task active-run minutes, engine-neutral wall-clock)
- `deadlineAt`: 24h from task start
- `activeRunMinutes`: accumulated wall-clock during active runs
- `lastActivityAt`: updated on activity

**Schema (additive only):** 5 fields added to `CodingSession` in `schema.prisma`

**Service:** `packages/adapters/src/coding-session-service.ts`
- `DeadlinePassedError` — thrown when `deadlineAt` is in the past
- `recordActivity(sessionId)` — updates `lastActivityAt`, increments `activeRunMinutes`
- `checkIdle(sessionId)` → `boolean` — true when no activity for `idleThresholdMinutes`
- `checkBudget(sessionId)` → `boolean` — false when `activeRunMinutes >= budgetMinutes`
- `checkDeadline(sessionId)` → `void | never` — throws `DeadlinePassedError` when `deadlineAt` passed
- Reuses `sleepComputerIfIdle` contract (existing machinery untouched)

**Tests:** 5 T30-specific + 19 pre-existing = 24/24 pass
```
idle suspend fires (T30) — 2 tests
budget exhaustion blocks (T30) — 1 test
deadline refuses resume (T30) — 2 tests
```

**Typecheck:** `pnpm --filter @rakazo/adapters run check` → 0 errors
**Commit:** `d144fc14` (cherry-picked from subagent `6b0af764`)

---

## T31 — CLI Package (V20)

**New package:** `apps/cli`

**Commands:**
- `attach` — fetch session list + pending approvals for a bot
- `approve` — approve a pending MCP server assignment
- `deny` — deny/dismiss a pending MCP server assignment
- `steer` — send a steer/prompt to a thread

**Architecture:** Thin HTTP client against existing API routes (no new server endpoints):
- `threads.listSessions`, `threads.get` — session attachment
- `mcp.assignments.approve` — approve path
- `mcp.assignments.dismiss` — deny path
- `threads.send` — steer path

**Tests:** 10/10 pass
```
apps/cli/src/client.test.ts — 10 tests
 ✓ attach returns session list
 ✓ attach returns empty list when no sessions
 ✓ getThread returns thread with pending approvals
 ✓ getThread returns empty messages when no approvals
 ✓ approveMcpAssignment approves
 ✓ approveMcpAssignment throws when not found
 ✓ denyMcpAssignment denies
 ✓ denyMcpAssignment throws when not found
 ✓ steer sends prompt and returns confirmation
 ✓ steer throws when thread not resolved
```

**Smoke script:** `apps/cli/src/smoke.ts` — runs with `pnpm dev` (expects network errors without server)
**Typecheck:** `pnpm exec tsc --noEmit` in `apps/cli/` → 0 errors
**Commit:** `83555fc8` (cherry-picked from subagent `c274a6d5a915c9a2bdb6cbbf41a9c0ea232b0179`)

---

## T32 — Mobile Workflow Enumeration (V21)

**Evidence:** Q8 decision artifact (`.super-speckit/design/004-code-mode/decision-s5-defaults.md`) + task text update
**Status:** DONE — no implementation needed; enumeration is the deliverable

---

## T33 — Matrix Closure + Release Summary

**Evidence:** `.super-speckit/docs/slice-reassessment-004-s5.md`
**Status:** DONE — committed `8cb1f9ff`

---

## Full Offline Suite Totals (ss/feature/004-s5 HEAD)

```
Test Files  7 failed | 488 passed | 32 skipped (527)
Tests       19 failed | 5956 passed | 188 skipped (6163)
```

**All 19 failures = pre-existing known set** (same as baseline 572b7668):
- `coding-doctor.test.ts` (1) — macOS env
- `coding-omp-protocol.test.ts` (5) — OMP stub + vitest stdin
- `coding-secrets-flow.test.ts` (1) — cgroup env
- `coding-project-secrets.test.ts` (1) — timeout (known env-gated)
- `process-collision-matrix.test.ts` (2) — privileged ports
- `process-sandbox-secrets.test.ts` (3) — cgroup env
- `process-sandbox.test.ts` (5) — macOS sandbox
- `infra/sandboxes/supervisor/src/computer-spec.test.ts` (1) — infra env

**Zero new failures introduced by this lane.**

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

## Commits (ss/feature/004-s5)

| SHA | T | Summary |
|---|---|---|
| `0f88977e` | docs | Record Q6/Q7/Q8 gate decisions |
| `1cd5b9f3` | docs | Append addenda to purpose-map and spec-grill |
| `49c7efc6` | T27 | Q7 devcontainer parser — IEnvironmentParser seam + subset + disclosure + tests |
| `ae9d285c` | T28 | PtySession type, FakeTerminalGateway reconnect/scrollback, resize propagation |
| `07bb19d4` | T29 | V7 authenticated previews — private by default, revocable sharing, no new auth internals |
| `d144fc14` | T30 | V19 budgets/idle — Q6 defaults (30min/120min/24h), checkBudget/Idle/Deadline |
| `83555fc8` | T31 | V20 CLI package — apps/cli with attach/approve/deny/steer, 10 tests + smoke |
| `8cb1f9ff` | T33 | Matrix closure + release summary — every V-row verified/not-verified with evidence |

---

## Declared Boundaries

1. **packages/auth** — PROTECTED. No source modifications in T29. Auth boundary respected via `authed` guard only.
2. **packages/adapter-kit interfaces.ts** — no changes to existing interface signatures. `TerminalRequest` gained optional field; no existing fields changed.
3. **ForgeClient** (T31) — lives in surfaces/CLI layer; worker composition has none. Documented in T31 evidence.
4. **Existing migration content** — all schema changes additive only. No existing columns modified.
