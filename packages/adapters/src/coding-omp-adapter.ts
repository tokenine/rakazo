/**
 * 004-code-mode T25 — OMP RPC coding adapter.
 *
 * Implements CodingEngineAdapter for the "omp" engine using the RPC JSONL stdio protocol
 * documented by the T24 experiment (grill addendum §G10/Q1 settled):
 * - Transport: spawn `omp --mode rpc` inside the sandbox task, declare HOME explicitly
 *   (omp reads $HOME/.omp for config/auth; probe used scrubbed env + explicit HOME).
 * - Framing: one JSON object per line on stdout; id-correlated request/response.
 * - ready frame: first stdout frame `{type:"ready", protocolVersion, ...}`.
 * - prompt: sends `{id, type:"prompt", prompt, options}`; turn ends at `agent_end`
 *   with `isTerminal != false`; `session_settled` signals end of non-yolo session.
 * - Approvals: non-yolo emits `extension_ui_request {method:"select", id, title, options}`
 *   for builtin tools; host routes to product approval gate; answer via
 *   `extension_ui_response {id, value:"Approve"|"Deny"}`. Fire-and-forget ui requests
 *   (setWidget/notify) need no reply. Unknown methods: cancel (not ignore).
 * - tool_execution_end: the ONLY trusted verification source per the integrity finding.
 *   Approve → isError false + captured stdout; Deny → isError true + denial message.
 * - get_messages_page: snapshot paging for history.
 * - Unattended: yolo + tools.approval deny-map; interactive: non-yolo overlay.
 *
 * Integrity rule (V2(omp)): verification MUST source tool_execution_end toolResults,
 * never assistant prose. The denied-run experiment proved the assistant TEXT claims
 * success even when the tool call was denied.
 */

import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { CodingEngineAdapter, CodingEngineId } from "./coding-engine.js";
import { type CodingSessionRef, UnsupportedEngineOperationError } from "./coding-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ops the OMP engine exposes — same surface as normal-pi, plus approve. */
export const OMP_SUPPORTED_OPS = [
  "prompt",
  "steer",
  "stop",
  "resume",
  "inspect_changes",
  "approvals",
] as const;

export type OmpSessionOp = (typeof OMP_SUPPORTED_OPS)[number];

export interface CodingOmpAdapterDeps {
  /**
   * Creates an OMP RPC session for the given sessionId.
   * Override in tests to inject a mock session.
   */
  sessionFactory(deps: CodingOmpAdapterDeps, sessionId: string): OmpRpcSession;
  /**
   * Spawns the `omp --mode rpc` child process inside the sandbox task environment.
   * The caller is responsible for configuring the task's HOME, env, and cwd.
   */
  spawnOmp(): Promise<ChildProcess>;
  /**
   * Called when the host surfaces an approval select to the user.
   * Resolves when the approval response has been sent to the OMP process.
   */
  approveTool(toolId: string, approval: "Approve" | "Deny"): Promise<void>;
}

export interface CodingOmpAdapter extends CodingEngineAdapter {
  dispatch<TResult extends object>(
    session: CodingSessionRef,
    op: OmpSessionOp | "approve",
    payload: Record<string, unknown>,
  ): Promise<TResult>;
  /** Expose approveTool for the deps injection. */
  approveTool(toolId: string, approval: "Approve" | "Deny"): Promise<void>;
}

// ---------------------------------------------------------------------------
// OMP RPC protocol frame types
// ---------------------------------------------------------------------------

interface OmpReadyFrame {
  type: "ready";
  protocolVersion: number;
  supportedProtocolVersions: number[];
  maxFrameBytes: number;
  maxReassembledFrameBytes?: number;
}
interface OmpResponseFrame {
  id: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface OmpExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method: string;
  title?: string;
  options?: string[];
  widgetKey?: string;
}

interface OmpExtensionUiResponse {
  id: string;
  type: "extension_ui_response";
  value: string;
}

interface OmpToolExecutionEnd {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result?: {
    content?: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  };
  isError: boolean;
}

interface OmpAgentEnd {
  type: "agent_end";
  messages: unknown[];
  isTerminal: boolean;
  yielded: boolean;
}

interface OmpSessionSettled {
  type: "session_settled";
}

type OmpFrame =
  | OmpReadyFrame
  | OmpResponseFrame
  | OmpExtensionUiRequest
  | OmpExtensionUiResponse
  | OmpToolExecutionEnd
  | OmpAgentEnd
  | OmpSessionSettled;

// ---------------------------------------------------------------------------
// Pending request tracker
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (frame: OmpFrame) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// OMP RPC session
// ---------------------------------------------------------------------------

export class OmpRpcSession {
  private proc: ChildProcess | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private nextId = 1;
  private ready = false;
  private _isSettled = false;
  private _pendingApprovals: Array<{
    id: string;
    method: string;
    title?: string;
    options?: string[];
  }> = [];
  private _lastToolResults: Array<{
    toolCallId: string;
    toolName: string;
    isError: boolean;
    result: unknown;
  }> = [];

  constructor(
    private readonly deps: CodingOmpAdapterDeps,
    private readonly sessionId: string,
  ) {}

  private makeId(): string {
    return `rak${this.nextId++}`;
  }

  private async waitForReady(): Promise<void> {
    if (this.ready) return;
    const frame = await this.waitForFrame("ready");
    if (frame.type !== "ready") throw new Error(`Expected ready frame, got ${frame.type}`);
    this.ready = true;
  }

  private waitForFrame(type?: string): Promise<OmpFrame> {
    const key = type ?? "__any__";
    // Executor form: repo lib is ES2023 (no Promise.withResolvers).
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(key);
        reject(new Error(`Timeout waiting for ${type ?? "any"} frame`));
      }, 30_000);
      this.pendingRequests.set(key, { resolve, reject, timeout });
    });
  }

  private sendRequest(id: string, frame: Record<string, unknown>): Promise<OmpFrame> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout waiting for response to ${id}`));
      }, 60_000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const writable = this.proc?.stdin as Writable | null;
      if (!writable) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error("No stdin available"));
        return;
      }

      writable.write(`${JSON.stringify({ ...frame, id })}\n`, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  private handleIncomingFrame(frame: OmpFrame): void {
    switch (frame.type) {
      case "ready":
        this.ready = true;
        break;

      case "response": {
        const p = this.pendingRequests.get(frame.id);
        if (p) {
          clearTimeout(p.timeout);
          this.pendingRequests.delete(frame.id);
          p.resolve(frame);
        }
        break;
      }

      case "extension_ui_request": {
        if (frame.method === "setWidget" || frame.method === "notify") {
          // Fire-and-forget: no response needed per docs
          return;
        }
        if (frame.method === "select") {
          this._pendingApprovals.push({
            id: frame.id,
            method: frame.method,
            title: frame.title,
            options: frame.options,
          });
          const p = this.pendingRequests.get("__any__");
          if (p) {
            clearTimeout(p.timeout);
            this.pendingRequests.delete("__any__");
            p.resolve(frame);
          }
        }
        break;
      }

      case "tool_execution_end":
        this._lastToolResults.push({
          toolCallId: frame.toolCallId,
          toolName: frame.toolName,
          isError: frame.isError,
          result: frame.result,
        });
        break;

      case "agent_end":
        this._isSettled = (frame as OmpAgentEnd).isTerminal !== false;
        break;

      case "session_settled":
        this._isSettled = true;
        break;
    }

    // Resolve type-keyed waiters, then the any-wildcard waiter. Both keys
    // must be resolved on every frame: prompt()/steer() wait on "__any__",
    // so an agent_end that only resolves "agent_end" deadlocks the turn.
    const typed = this.pendingRequests.get(frame.type);
    if (typed) {
      clearTimeout(typed.timeout);
      this.pendingRequests.delete(frame.type);
      typed.resolve(frame);
    }
    const any = this.pendingRequests.get("__any__");
    if (any) {
      clearTimeout(any.timeout);
      this.pendingRequests.delete("__any__");
      any.resolve(frame);
    }
  }

  async start(): Promise<void> {
    this.proc = await this.deps.spawnOmp();

    const rl = createInterface({
      input: this.proc.stdout as Readable,
      crlfDelay: Infinity,
    });

    rl.on("line", (line: string) => {
      if (!line.trim()) return;
      try {
        const frame = JSON.parse(line) as OmpFrame;
        this.handleIncomingFrame(frame);
      } catch {
        // Malformed frame: ignore per protocol recovery guidance
      }
    });

    this.proc.on("error", (err) => {
      this.pendingRequests.forEach((p) => {
        clearTimeout(p.timeout);
        p.reject(err);
      });
      this.pendingRequests.clear();
    });

    this.proc.on("close", () => {
      this.pendingRequests.forEach((p) => {
        clearTimeout(p.timeout);
      });
      this.pendingRequests.clear();
    });

    await this.waitForReady();
  }

  async prompt(
    text: string,
  ): Promise<{ sessionId: string; runId?: string; steered?: boolean; isTerminal: boolean }> {
    await this.waitForReady();
    const id = this.makeId();
    await this.sendRequest(id, { type: "prompt", message: text });
    let agentEnd: OmpAgentEnd | null = null;
    while (!this._isSettled) {
      const frame = await this.waitForFrame();
      if (frame.type === "agent_end") {
        agentEnd = frame as OmpAgentEnd;
      }
    }
    return {
      sessionId: this.sessionId,
      isTerminal: agentEnd?.isTerminal !== false,
    };
  }

  async steer(text: string): Promise<{ runId: string; steered: boolean }> {
    await this.waitForReady();
    const id = this.makeId();
    await this.sendRequest(id, { type: "prompt", message: text });
    let _agentEnd: OmpAgentEnd | null = null;
    while (!this._isSettled) {
      const frame = await this.waitForFrame();
      if (frame.type === "agent_end") {
        _agentEnd = frame as OmpAgentEnd;
      }
    }
    return {
      runId: this.sessionId,
      steered: true,
    };
  }

  async stop(): Promise<{ stopped: boolean }> {
    const id = this.makeId();
    try {
      await this.sendRequest(id, { type: "abort", id });
    } catch {
      // best effort
    }
    this.proc?.kill();
    return { stopped: true };
  }

  async resume(): Promise<{ resumed: boolean }> {
    await this.waitForReady();
    const id = this.makeId();
    await this.sendRequest(id, { type: "get_state" });
    return { resumed: true };
  }

  async inspectChanges(): Promise<{
    messages: unknown[];
    toolResults: Array<{ toolCallId: string; toolName: string; isError: boolean; result: unknown }>;
  }> {
    await this.waitForReady();
    const id = this.makeId();
    const resp = (await this.sendRequest(id, { type: "get_messages_page" })) as OmpResponseFrame;
    const messages = (resp.data as { messages?: unknown[] })?.messages ?? [];
    return {
      messages,
      toolResults: this._lastToolResults,
    };
  }

  async getPendingApprovals(): Promise<{
    pending: Array<{ id: string; method: string; title?: string; options?: string[] }>;
  }> {
    return { pending: [...this._pendingApprovals] };
  }

  async approveTool(toolId: string, approval: "Approve" | "Deny"): Promise<void> {
    if (approval !== "Approve" && approval !== "Deny") {
      throw new Error(`Approval must be "Approve" or "Deny", got ${JSON.stringify(approval)}`);
    }
    await this.waitForReady();
    const writable = this.proc?.stdin as Writable | null;
    if (!writable) throw new Error("No stdin available");
    writable.write(
      `${JSON.stringify({ type: "extension_ui_response", id: toolId, value: approval })}\n`,
      () => {},
    );
    this._pendingApprovals = this._pendingApprovals.filter((a) => a.id !== toolId);
    await this.deps.approveTool(toolId, approval);
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const OMP_ADAPTER_SUPPORTED_OPS: ReadonlySet<string> = new Set<string>([
  ...OMP_SUPPORTED_OPS,
  "approve", // adapter-specific op for the approval round-trip
]);

/**
 * Creates the OMP coding engine adapter.
 *
 * The adapter manages one OMP RPC session per (workspace, engine) binding.
 * Sessions are spawned fresh on resume (the OMP process is ephemeral per the
 * experiment: named sessions persist, but the adapter controls the lifecycle).
 */
export function createCodingOmpAdapter(deps: CodingOmpAdapterDeps): CodingOmpAdapter {
  const sessions = new Map<string, OmpRpcSession>();

  async function dispatch<TResult extends object>(
    session: CodingSessionRef,
    op: string,
    payload: Record<string, unknown>,
  ): Promise<TResult> {
    if (!OMP_ADAPTER_SUPPORTED_OPS.has(op)) {
      throw new UnsupportedEngineOperationError(session.engine as CodingEngineId, op);
    }

    const key = `${session.id}:${session.workspaceId}`;
    let sess = sessions.get(key);
    if (!sess) {
      sess = deps.sessionFactory(deps, session.id);
      sessions.set(key, sess);
      sess.start().catch(() => {
        sessions.delete(key);
      });
    }

    switch (op) {
      case "prompt": {
        return sess.prompt(String(payload.text ?? "")) as Promise<TResult>;
      }

      case "steer": {
        return sess.steer(String(payload.text ?? "")) as Promise<TResult>;
      }

      case "stop": {
        return sess.stop() as Promise<TResult>;
      }

      case "resume": {
        return sess.resume() as Promise<TResult>;
      }

      case "inspect_changes": {
        return sess.inspectChanges() as Promise<TResult>;
      }

      case "approvals": {
        return sess.getPendingApprovals() as Promise<TResult>;
      }

      case "approve": {
        return sess
          .approveTool(String(payload.id ?? ""), payload.value as "Approve" | "Deny")
          .then(() => ({ approved: payload.value }) as unknown as TResult);
      }

      default:
        throw new UnsupportedEngineOperationError(session.engine as CodingEngineId, String(op));
    }
  }

  return {
    id: "omp",
    supportedOps: OMP_ADAPTER_SUPPORTED_OPS as unknown as ReadonlySet<OmpSessionOp>,
    describe: () => "OMP RPC adapter (jsonl stdio, --mode rpc)",

    dispatch,

    approveTool: async (toolId: string, approval: "Approve" | "Deny") => {
      const session = [...sessions.values()][0];
      if (session) {
        await session.approveTool(toolId, approval);
      } else {
        await deps.approveTool(toolId, approval);
      }
    },
  };
}
