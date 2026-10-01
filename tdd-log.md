# S4 TDD Log — 004-code-mode Slice 4 (fix-round)

## T25 RED → GREEN: OMP adapter dispatch()

**RED (bc442097 — stub):**
- `dispatch("prompt")` returned fake `{ok: true}` without sending anything
- `dispatch("inspect_changes")` returned `{}` (TODO stub)
- `dispatch("approvals")` returned `{pending: []}` (TODO stub)
- `dispatch("resume")` returned `{resumed: true}` (no-op)

**Probe findings (2026-10-02):**
- Empirical probe of `omp --mode rpc` JSONL protocol over stdio
- Command field: `type` JSON field carries command name
- ALL coding ops (`prompt`/`steer`/`stop`/`resume`/`inspect_changes`/`approvals`) return `Unknown command: <op>` — no such RPC commands exist
- `extension_ui_request` notifications arrive asynchronously (the real approval channel)
- Only `compact` and `handoff` are recognized (with preconditions)
- Protocol uses closure-based `setOnLine` callback registration

**GREEN:**
- `createProcessTransport()`: real subprocess transport with JSONL framing, ready handshake, setOnLine callback
- `CodingOmpAdapter.dispatch()` throws `UnsupportedEngineOperationError` for ALL 6 coding ops with full probe evidence (op name, command, error, probe note)
- `extension_ui_request` captured into `pendingApprovals[]` queue
- `transport.setOnLine()` for testability (fake transport in tests)
- 13 tests: 9 unit (UNSUPPORTED errors for all ops), 3 transport tests, 1 integration skip

---

## T25 transport abstraction

**RED:** No transport override mechanism; tests could not inject fake subprocess
**GREEN:** `CreateOmpAdapterOptions.transport?: OmpTransport` allows test double; fake transport in tests tracks sent lines and injects canned responses

---

## T23 dirty-set: investigation result

**Claimed (incorrectly in prior lane):** dirty-set from `codingHistory` table
**Reality:** `codingHistory` table does NOT exist in schema. Dirty-set tracked in executor process memory (`workspaceCheckpoint.markDirty()`) — LOST on crash unless `flush()` was called.

**GREEN (honest):**
- `getCrashReconciliationData` in `coding-session-continuity.ts` uses `steeringMessage` for `lastAction` (existing schema)
- Dirty-set returns `[]` via steeringMessage (no separate dirty path table exists)
- `isRunSuccessful`: `run.status === "completed"` (correct)
- T23 tests in `coding-session-continuity.test.ts` correctly assert {sessionId, runId, outcome, isSuccess} — no false dirtySet claims

---

## T26 GREEN

`coding-session-continuity.test.ts` — 4 V15 planContinuation tests green

---

## Suite: 72/72 green (S4 tests + S1 seam tests)

