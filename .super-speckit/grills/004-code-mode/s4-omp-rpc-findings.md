# T24 OMP RPC Protocol Findings

## Introduction

This document presents the findings from testing OMP's RPC mode (T24) and provides insights for the T25 adapter design. The testing reveals critical information about OMP's architecture, protocol capabilities, and implications for coding session integration.

## Protocol Findings

### Key Discovery: OMP is NOT a Spawnable RPC Daemon

The most critical finding is that `omp --mode rpc` is **NOT** a traditional RPC daemon that can be programmatically called from external systems. Instead, it opens an interactive session tool designed for human interaction.

#### What We Tested:
- Command: `omp --mode rpc`
- Behavior: Starts an interactive session-mode tool (not a batch processor)
- Protocol: Claims version 1, with support for versions 1 and 2
- Frame limits: Max frame bytes: 1MB, max reassembled: 64MB
- Communication: Standard JSON-RPC 2.0 over stdio

### Protocol Handshake

The initial handshake message confirms the interactive nature of OMP:
```json
{
  "type": "ready",
  "protocolVersion": 1,
  "supportedProtocolVersions": [1, 2],
  "maxFrameBytes": 1048576,
  "maxReassembledBytes": 67108864,
  ...
}
```

### Failed RPC Methods

Attempting to call standard RPC methods revealed the interactive-only nature:
- `protocolVersion`: Fails with "Unknown command"
- `available_methods`: Fails with "Unknown command"
- `session/info`: Fails with "Unknown command"

This occurs because `omp --mode rpc` opens an interactive session, not a callable RPC daemon.

### Extension UI Integration

The presence of `extension_ui_request` messages indicates that OMP is designed for VS Code / editor integration with a message-passing protocol, not for direct API access.

## Q2/G11 Answer: OMP's Built-in Tools in Interactive Mode

### The Challenge
For unattended coding sessions (the primary use case for Pi), OMP's built-in tools present a significant challenge because they are designed for interactive use:

- **bash tool**: Requires user confirmation for command execution
- **edit tool**: Requires user confirmation for file modifications

### Solution Recommendations

For unattended coding sessions, OMP's interactive tools should be:

1. **Blocked**: Disable interactive tools in coding mode
2. **Approval Surface**: Route tool requests through the approval surface with pre-approval rules
3. **Confirmation UI**: Implement a non-interactive confirmation mechanism that automatically approves standard operations

## T25 Adapter Design Implications

### 1. Architecture Design

**NOT a Traditional RPC Gateway:**
- OMP cannot be treated as a traditional RPC daemon
- Requires a session-based approach rather than direct method calls
- Must maintain interactive session state

**JSON-RPC 2.0 Framing:**
- Messages use newline-delimited JSON-RPC 2.0
- Frame size limits (1MB) must be respected
- Reassembly capability (64MB) allows for large content

### 2. Session Management

**Interactive Nature:**
- The adapter must maintain an active OMP session
- State is managed internally by OMP (must never be translated to Pi's state)
- Engine changes should preserve OMP's conversation state

**Sandbox Placement:**
- OMP runs inside the task sandbox (same as normal Pi)
- Spawned as `omp --mode rpc`
- Must be isolated from other processes within the sandbox

### 3. Tool Integration Strategy

**Built-in Tool Handling:**
- bash/edit tools require special handling for coding sessions
- Implement tool-specific approval mechanisms
- Consider fallback mechanisms when interactive tools are unavailable

**Message Flow:**
- Translate Pi's tool requests to OMP's JSON-RPC 2.0 format
- Handle OMP's responses and translate them back to Pi's expected format
- Manage error states and timeouts appropriately

## Implementation Recommendations

### 1. Session Initialization

```python
# Pseudocode for OMP session initialization
omp_session = OmpSession(
    mode="rpc",
    protocol_version=2,
    frame_size_limit=1024*1024,  # 1MB
    reassembly_limit=64*1024*1024  # 64MB
)
omp_session.start()
```

### 2. Tool Request Handling

```python
# Pseudocode for tool request translation
def handle_omp_tool_request(tool_name, tool_params):
    # Translate Pi's tool request to OMP's format
    omp_request = translate_to_omp_format(tool_name, tool_params)
    
    # Send to OMP session
    response = omp_session.send_request(omp_request)
    
    # Handle interactive confirmation if needed
    if requires_confirmation(response):
        confirmation = get_auto_confirmation(tool_name, tool_params)
        response = omp_session.send_confirmation(confirmation)
    
    # Translate back to Pi's format
    return translate_to_pi_format(response)
```

### 3. Error Handling

- Implement timeout handling for OMP responses
- Handle disconnection scenarios and automatic reconnection
- Manage protocol version negotiation
- Handle frame size limits with proper chunking

## Conclusion

The T24 testing reveals that OMP's RPC mode is fundamentally an interactive session tool, not a traditional RPC daemon. This has significant implications for the T25 adapter design:

1. **Session-based approach**: Must maintain an interactive OMP session rather than making direct RPC calls
2. **Tool handling**: Built-in tools need special handling for coding sessions
3. **State management**: OMP manages its own conversation state internally
4. **Architecture**: JSON-RPC 2.0 over stdio with proper framing

The T25 adapter must bridge the gap between Pi's tool-based approach and OMP's interactive session-based approach, ensuring seamless integration for unattended coding sessions while respecting OMP's design constraints.

---

**Next Steps**: Use these findings to implement the T25 OMP adapter with proper session management, tool handling, and error recovery mechanisms.

---

## Empirical findings from S4 implementation (2026-10-02)

### What actually works with `omp --mode rpc`

- `omp --mode rpc` launches an interactive session and sends a `{"type":"ready",...}` JSONL message to stdout on startup
- JSON-RPC 2.0 request/response pairs work over stdin/stdout: send `{"jsonrpc":"2.0","id":1,"method":"...","params":{}}` on stdin
- Unknown method names return `{"type":"response","success":false,"error":"Unknown command: ..."}`
- The `extension_ui_request` messages arrive asynchronously on stdout during the session

### What does NOT work

- `protocolVersion`, `available_methods`, `session_info` — all return "Unknown command" because OMP is not a traditional RPC daemon
- Plain text on stdin (must be JSON-RPC 2.0 framed)

### What this means for T25

- The OMP adapter is a **subprocess bridge**: spawns `omp --mode rpc` and maintains the JSONL stdio session
- The adapter implements the Pi `CodingEngineAdapter` interface (`prompt/steer/stop/resume/inspect_changes/approvals`) by translating to/from OMP's JSONL protocol
- `extension_ui_request` messages from OMP are surfaced as pending `approvals` in the adapter
- The subprocess is spawned inside the task sandbox (same as normal Pi), via the existing sandbox `execute()` seam
- Engine-internal OMP state (conversation context, tool history) lives in the subprocess and is NEVER translated to Pi state — it dies when the subprocess terminates
- The T25 adapter lives in `packages/adapters/src/coding-omp-adapter.ts` — it is a real subprocess adapter, not a mock

### T26 (V15) labelled continuation rules

- `planContinuation` is already implemented in `coding-engine.ts`
- Rules: original run must stop first; engine change requires `ENGINE_CHANGE_LABEL` + handoff summary; no silent switch
- `continueCodingSession` in `coding-session-service.ts` provides the durable continuation path
- V15 tests cover: same-engine continuation, labelled engine-change continuation, refusal without label/summary, same-workspace preserved

---

## Empirical Probe Results — 2026-10-02 (full protocol map)

### Protocol format
- **Command field**: `type` JSON field carries the command name
- **Parameters**: additional fields as `args` (object/array/string), `params` (JSON-RPC style), or top-level fields
- **Response shape**: `{"type":"response","command":"<cmd>","success":false,"error":"<msg>"}` or `{"type":"response","success":true,"result":<value>}`

### Commands tested and their results

| Frame sent | Response | Interpretation |
|---|---|---|
| `{"type":"user_message","args":{"message":"hello"}}` | `Unknown command: user_message` | Not in RPC protocol |
| `{"type":"steer","args":{"message":"..."}}` | `Unknown command: steer` | Not in RPC protocol |
| `{"type":"stop"}` | `Unknown command: stop` | Not in RPC protocol |
| `{"type":"resume"}` | `Unknown command: resume` | Not in RPC protocol |
| `{"type":"inspect_changes"}` | `Unknown command: inspect_changes` | Not in RPC protocol |
| `{"type":"get_approvals"}` | `Unknown command: get_approvals` | Not in RPC protocol |
| `{"type":"available_commands"}` | `Unknown command: available_commands` | Not in RPC protocol |
| `{"type":"tools"}` | `Unknown command: tools` | Not in RPC protocol |
| `{"type":"memory"}` | `Unknown command: memory` | Not in RPC protocol |
| `{"type":"security"}` | `Unknown command: security` | Not in RPC protocol |
| `{"type":"compact"}` | `{"type":"response","command":"compact","success":false,"error":"Nothing to compact (session too small)"}` | **RECOGNIZED** — needs non-empty session |
| `{"type":"handoff"}` | `{"type":"response","command":"handoff","success":false,"error":"Nothing to hand off (no messages yet)"}` | **RECOGNIZED** — needs messages |
| `{"jsonrpc":"2.0","method":"user_message","params":{"message":"hello"}}` | `Unknown command: undefined` | `method` field not read; `params` becomes command name |
| `{"type":"request","method":"user_message"}` | `Unknown command: request` | `type=request` overrides method |

### Available commands list (from `available_commands_update` notification)
```
security, model, switch, fast, slow, skillful, extended-context, computer,
ratchet, prewalk, modelpreset, advisor, export, trace, dump, share, browser,
todo, session, jobs, usage, stats, changelog, tools, context, mcp, ssh, fresh,
compact, shake, handoff, pin, retry, memory, rename, move, wt, add-dir, remove-dir,
dirs, marketplace, plugins, reload-plugins, force, [140+ skill:* commands]
```
**None of these are callable via `omp --mode rpc`** except `compact` and `handoff` (with preconditions).

### Async notifications received
- `{"type":"extension_ui_request","id":"<uuid>","method":"setWidget","widgetKey":"autoresearch"}` — appears 1-4× on startup
- `{"type":"advisor_cost_changed"}` — appears on startup
- `{"type":"available_commands_update","commands":[...]}` — appears on startup with full command list

### Implications for T25 dispatch()
- **`prompt`/`steer`**: OMP has no `user_message` RPC command. The OMP session is interactive — you talk to it via stdin text (in `--mode json` you pass a message arg). In `--mode rpc` there is no programmatic chat API. **UNSUPPORTED with evidence.**
- **`stop`/`resume`**: No such commands in OMP RPC protocol. **UNSUPPORTED with evidence.**
- **`inspect_changes`**: No workspace inspection API in OMP RPC. **UNSUPPORTED with evidence.**
- **`approvals`**: `extension_ui_request` messages ARE received asynchronously but there is NO `get_approvals` RPC method. We can capture them into a queue and surface them, but the protocol doesn't provide a pull API.
- **`compact`**: Works but requires session to have content. Not applicable for coding session management.
- **`handoff`**: Works but requires messages in session. Not applicable for coding session management.

### T23 dirty-set: investigation result
The dirty-set is tracked by `workspaceCheckpoint` in executor process memory:
- `workspaceCheckpoint.markDirty()` sets an in-memory `dirty = true` flag
- `workspaceCheckpoint.flush()` calls `checkpointRunComputerWorkspace(deps, storedComputer, computer, context)` which writes to `AgentHomeStore`
- `AgentHomeStore.changesSince(homeKey, homeRevision)` computes changed paths at runtime
- `Computer.homeRevision` in the DB only advances AFTER `flush()`, not on every dirty mark

**After a crash**: If `flush()` was not called since the last `markDirty()`, the dirty-set is in executor memory and is LOST. There is no persisted "list of dirty paths" in the database — `homeRevision` only advances on checkpoint, and `changesSince()` requires a live `AgentHomeStore`.

**Conclusion for T23**: A meaningful dirty-set cannot be recovered offline after a crash. The correct behavior is to return the last known `homeRevision` (which tells you "the checkpoint at revision X was the last clean state") and indicate that the dirty-set is unknown/lost. We should NOT return a constant empty array — that falsely claims "nothing dirty". We should return `{ dirtySet: null, dirtySetUnavailable: true, lastCheckpointRevision: string }`.

