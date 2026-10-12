"""T24 (Q1/G10 + Q2/G11) live probe: drive `omp --mode rpc` over JSONL stdio.

Records every stdout frame to a JSONL evidence log. Sub-probes:
  basic          - ready handshake, state, trivial model turn, history paging
  approval-write - non-yolo overlay; approvals arrive as extension_ui_request
                   select frames; host approves -> bash runs
  approval-yolo  - default yolo; bash runs with no approval frame
"""
import json
import os
import subprocess
import sys
import time

ROOT = "/tmp/omp-rpc-probe"
WORKSPACE = os.path.join(ROOT, "workspace")
os.makedirs(WORKSPACE, exist_ok=True)

MIN_ENV = {
    "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
    "HOME": os.environ.get("HOME", "/root"),
    "TERM": "dumb",
    "LANG": "C.UTF-8",
}


def log(name, kind, obj):
    line = json.dumps({"probe": name, "kind": kind, "frame": obj}, default=str)
    with open(os.path.join(ROOT, f"{name}.frames.jsonl"), "a") as f:
        f.write(line + "\n")


def spawn(name, extra_args):
    argv = ["omp", "--mode", "rpc", "--no-session"] + extra_args
    with open(os.path.join(ROOT, f"{name}.stderr.log"), "wb") as errf:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=errf,
            text=True,
            bufsize=1,
            cwd=WORKSPACE,
            env=MIN_ENV,
        )
    with open(os.path.join(ROOT, f"{name}.argv.json"), "w") as f:
        json.dump(argv, f)
    return proc


def send(proc, obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


def respond_ui(proc, name, frame, approve_allow_tools):
    """Answer an extension_ui_request. Approval selects get Approve/Deny;
    everything else is cancelled so nothing deadlocks."""
    method = frame.get("method")
    rid = frame.get("id")
    if method == "select" and (frame.get("title") or "").startswith("Allow tool:"):
        value = "Approve" if approve_allow_tools else "Deny"
        send(proc, {"type": "extension_ui_response", "id": rid, "value": value})
        log(name, "ui_response", {"id": rid, "value": value})
        return
    if method in ("select", "confirm", "input", "editor"):
        send(proc, {"type": "extension_ui_response", "id": rid, "cancelled": True})
        log(name, "ui_response", {"id": rid, "cancelled": True, "method": method})
    else:
        log(name, "ui_fire_forget", {"id": rid, "method": method})


def drive_turn(proc, name, prompt_id, message, max_seconds=120, approve_allow_tools=True):
    """Send a prompt; collect frames until terminal agent_end or local completion."""
    send(proc, {"id": prompt_id, "type": "prompt", "message": message})
    deadline = time.time() + max_seconds
    text_parts = []
    tool_events = []
    done = False
    while not done and time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            break
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            log(name, "unparseable", {"raw": line[:400]})
            continue
        log(name, "frame", frame)
        ftype = frame.get("type")
        if ftype == "extension_ui_request":
            respond_ui(proc, name, frame, approve_allow_tools)
        elif ftype == "message_update":
            ev = frame.get("assistantMessageEvent", {})
            if ev.get("type") == "text_delta":
                text_parts.append(ev.get("delta", ""))
        elif ftype == "tool_execution_start":
            tool_events.append({"phase": "start", "toolName": frame.get("toolName"), "args": frame.get("args")})
        elif ftype == "tool_execution_end":
            tool_events.append({"phase": "end", "toolName": frame.get("toolName"), "isError": frame.get("isError"), "result": frame.get("result")})
        elif ftype == "agent_end" and frame.get("isTerminal") is not False:
            done = True
        elif ftype == "prompt_result" and frame.get("agentInvoked") is False:
            done = True
        elif ftype == "response" and frame.get("id") == prompt_id:
            if frame.get("success") is False:
                return {"ok": False, "error": frame.get("error"), "text": "".join(text_parts), "tools": tool_events}
            if frame.get("data", {}).get("agentInvoked") is False:
                done = True
    if not done:
        return {"ok": False, "error": "timeout waiting for turn completion", "text": "".join(text_parts), "tools": tool_events}
    return {"ok": True, "terminal": True, "text": "".join(text_parts), "tools": tool_events}


def read_ready(proc, name):
    line = proc.stdout.readline()
    frame = json.loads(line)
    log(name, "ready", frame)
    return frame


def rpc(proc, name, rid, cmd, **fields):
    send(proc, {"id": rid, "type": cmd, **fields})
    while True:
        line = proc.stdout.readline()
        if not line:
            return None
        frame = json.loads(line)
        log(name, "frame", frame)
        if frame.get("type") == "extension_ui_request":
            respond_ui(proc, name, frame, True)
            continue
        if frame.get("type") == "response" and frame.get("id") == rid:
            return frame


def probe_basic():
    name = "basic"
    proc = spawn(name, [])
    try:
        ready = read_ready(proc, name)
        state = rpc(proc, name, "s1", "get_state")
        models = rpc(proc, name, "m1", "get_available_models")
        model_count = len((models.get("data") or {}).get("models", [])) if models and models.get("success") else None
        turn = drive_turn(proc, name, "p1", "Reply with only the word ok")
        page1 = rpc(proc, name, "g1", "get_messages_page", limit=10)
        stats = rpc(proc, name, "st1", "get_session_stats")
        return {
            "ready_protocol": ready.get("protocolVersion"),
            "supported_versions": ready.get("supportedProtocolVersions"),
            "max_frame_bytes": ready.get("maxFrameBytes"),
            "state_model": ((state.get("data") or {}).get("model") or {}).get("id") if state and state.get("success") else None,
            "model_count": model_count,
            "turn": turn,
            "history_messages": len(((page1.get("data") or {}).get("messages") or [])) if page1 and page1.get("success") else None,
            "history_next_cursor": ((page1.get("data") or {}).get("nextCursor")) if page1 and page1.get("success") else None,
            "stats_total_messages": ((stats.get("data") or {}).get("totalMessages")) if stats and stats.get("success") else None,
        }
    finally:
        proc.stdin.close()
        proc.wait(timeout=20)


def probe_approval(mode, config_path=None, approve_allow_tools=True):
    name = f"approval-{mode}" + ("" if approve_allow_tools else "-deny")
    extra = ["--config", config_path] if config_path else []
    proc = spawn(name, extra)
    try:
        read_ready(proc, name)
        turn = drive_turn(
            proc, name, "p1",
            "Run exactly this shell command with the bash tool and reply with its stdout only: echo omp-rpc-probe-ok",
            approve_allow_tools=approve_allow_tools,
        )
        return {"mode": mode, "approved": approve_allow_tools, "turn": turn}
    finally:
        proc.stdin.close()
        proc.wait(timeout=20)


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    results = {}
    if which in ("all", "basic"):
        results["basic"] = probe_basic()
    if which in ("all", "write"):
        overlay = os.path.join(ROOT, "write-approvals.yml")
        with open(overlay, "w") as f:
            f.write("tools:\n  approvalMode: write\n")
        results["approval-write"] = probe_approval("write", overlay, approve_allow_tools=True)
        results["approval-write-denied"] = probe_approval("write", overlay, approve_allow_tools=False)
    if which in ("all", "yolo"):
        results["approval-yolo"] = probe_approval("yolo")
    print(json.dumps(results, indent=2, default=str))
