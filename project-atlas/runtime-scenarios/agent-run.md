# Runtime scenario: user message → agent run → reply (web path)

Status: verified from code paths cited; not yet confirmed against a live run.

```text
User (web/desktop/mobile)
  │ typed message (clientNonce for idempotency)
  ▼
oRPC threads.sendUserMessage ── packages/db/src/events.ts:335
  │ one transaction:
  │   1. insert user message (thread row-lock serializes vs clearThread)
  │   2. if no active run for thread/bot → create task + run (queued), link message
  ▼
jobs.enqueue(runContinueJob(runId))            (api side or worker)
  ▼
Graphile worker drains "run_continue"          packages/adapters/src/background-job-handlers.ts
  ▼
executor.continueRun(runId, workerId)          packages/adapters/src/executor.ts:1094
  │ claim fence + run lease + computer execution lease (one run per bot VM)
  │ resolveModel: bot override → default credential → deployment settings → fallback
  │ provisionComputer(...) + workspace checkpoint
  │ selectBuiltinToolsForRun: shell/file/message_user, delegation subagents,
  │   browser tools (VM), computer_observe/act, client-browser tools (if desktop online
  │   and Built-in-browser preference swaps VM browser out), MCP/connector tools
  ▼
PiAgentRuntime.run(...)                        packages/adapters/src/pi-runtime.ts:122
  │ build pi-ai Agent: system prompt (bot-with-computer vs sandbox-shell persona),
  │ thinking level clamp, steering claim, screenshot/context pruning, tool budget
  │ stream events → RealtimeFanout → SSE to clients
  │ tool loop: executor persists artifacts via ArtifactStore
  ▼
persistMessageInTransaction (assistant message)   executor.ts:4825
  ▼
Realtime events update thread UI; artifacts render in thread
```

Error paths: run lease expiry releases the computer lease; abort via AbortController;
approval gates (`packages/core/src/action-approval.ts`) can pause the loop waiting for a
user YES/NO (run status `waiting_input`).
