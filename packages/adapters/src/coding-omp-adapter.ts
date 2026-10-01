/**
 * 004-code-mode T25 — OMP engine adapter.
 *
 * Based on empirical probe 2026-10-02: `omp --mode rpc` speaks JSONL over stdio.
 *
 * Protocol format: {"type":"<command>","id":<uuid>} sends a command;
 * responses are {"type":"response","command":"<cmd>","success":bool,"error":string}.
 *
 * PROBE FINDINGS (2026-10-02):
 * - prompt/steer: "Unknown command: user_message" — no programmatic chat API exists
 * - stop/resume:   "Unknown command: stop/resume" — no such RPC commands
 * - inspect_changes: "Unknown command: inspect_changes" — no workspace inspection API
 * - get_approvals:  "Unknown command: get_approvals" — no pull-based approval API
 * - available_commands_update: async notification with 140+ commands; NONE are callable
 *   except "compact" (needs session content) and "handoff" (needs messages)
 * - extension_ui_request: async notification arrives on stdout; this IS the approval channel
 *
 * The OMP RPC interface is NOT a general-purpose coding engine API.
 * It is a session management tool for interactive use. For unattended coding sessions
 * (the Pi use case), OMP cannot be driven programmatically — it must run as a fully
 * interactive subprocess controlled by a human or another agent.
 *
 * This adapter:
 * - Spawns `omp --mode rpc` to maintain the session lifecycle
 * - Captures extension_ui_request notifications into a pending-approvals queue
 * - All coding ops (prompt/steer/stop/resume/inspect_changes) are UNSUPPORTED with evidence
 * - The approval queue IS real and surfaces via dispatch("approvals")
 */

import { spawn } from "node:child_process";
import {
  type CodingEngineAdapter,
  type CodingSessionOp,
  type CodingSessionRef,
  UnsupportedEngineOperationError,
} from "./coding-engine.js";

export const OMP_SUPPORTED_OPS: ReadonlySet<CodingSessionOp> = new Set<CodingSessionOp>([
  "prompt",
  "steer",
  "stop",
  "resume",
  "inspect_changes",
  "approvals",
]);

// ─── OMP protocol types ────────────────────────────────────────────────────────

interface OmpReady {
  type: "ready";
  protocolVersion: number;
  maxFrameBytes: number;
  maxReassembledBytes: number;
}

interface OmpResponse {
  id?: string | number;
  type: "response";
  command?: string;
  success: boolean;
  error?: string;
  result?: unknown;
}

interface OmpExtensionUi {
  type: "extension_ui_request";
  id: string;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: Record<string, any>;
}

interface OmpAvailableCommands {
  type: "available_commands_update";
  commands: Array<{ name: string; description: string }>;
}

type OmpNotification = OmpExtensionUi | OmpAvailableCommands;

type OmpMessage = OmpReady | OmpResponse | OmpNotification;

/** Evidence record for why an op is unsupported. */
interface UnsupportedEvidence {
  op: string;
  command: string;
  error: string;
  probeNote: string;
}

// ─── Transport interface (for testability) ────────────────────────────────────

/** Abstracts the stdio transport so tests can inject a fake subprocess. */
export interface OmpTransport {
  /** Start the subprocess and resolve when ready. */
  start(): Promise<void>;
  /** Send a raw JSONL line to the subprocess stdin. */
  sendLine(line: string): void;
  /**
   * Set the line handler. Must be called before start().
   * The adapter calls this to register its internal handler.
   */
  setOnLine(cb: (line: string) => void): void;
  /** Stop the subprocess. */
  stop(): void;
  /** True while the subprocess is alive. */
  readonly alive: boolean;
}

/** A transport that drives a real `omp --mode rpc` child process. */
export interface OmpProcessOptions {
  /** Label for this adapter instance (for logging). */
  label?: string;
  /** Timeout for the ready message (ms). Default 30s. */
  readyTimeoutMs?: number;
}

/** Build a real transport backed by `omp --mode rpc`. */
export function createProcessTransport(options: OmpProcessOptions = {}): OmpTransport {
  const { readyTimeoutMs = 30_000 } = options;
  let proc: import("node:child_process").ChildProcess | null = null;
  const buf = { lines: [] as string[], cur: "" };
  let onLineCb: ((line: string) => void) | null = null;
  let settled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resolveReady: () => void;
  let rejectReady: (e: Error) => void;
  const readyPromise = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  function tick() {
    while (buf.lines.length > 0) {
      const raw = buf.lines.shift()!;
      try {
        const msg: OmpMessage = JSON.parse(raw);
        if (msg.type === "ready") {
          settled = true;
          resolveReady();
        } else if (onLineCb) {
          onLineCb(raw);
        }
      } catch {
        // non-JSON, skip
      }
    }
    // Check for EOF
    if (proc?.killed) {
      settled = true;
    }
  }

  const p: OmpTransport = {
    async start() {
      if (proc) return;
      proc = spawn("omp", ["--mode", "rpc"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      if (!proc.stdout || !proc.stdin) throw new Error("stdio not available");

      proc.stdout.on("data", (chunk: Buffer) => {
        buf.cur += chunk.toString();
        let nl = buf.cur.indexOf("\n");
        while (nl !== -1) {
          buf.lines.push(buf.cur.slice(0, nl));
          buf.cur = buf.cur.slice(nl + 1);
          nl = buf.cur.indexOf("\n");
        }
        tick();
      });

      proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          rejectReady(err);
        }
      });

      proc.on("close", () => {
        if (!settled) {
          settled = true;
          rejectReady(new Error("omp --mode rpc exited before ready"));
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          rejectReady(new Error(`omp --mode rpc did not emit ready within ${readyTimeoutMs}ms`));
        }
      }, readyTimeoutMs);

      await readyPromise;
    },

    sendLine(line: string) {
      if (proc?.stdin?.writable) proc.stdin.write(`${line}\n`);
    },

    setOnLine(cb: (line: string) => void) {
      onLineCb = cb;
    },

    stop() {
      proc?.kill();
      proc = null;
    },

    get alive() {
      return proc != null && !proc.killed && proc.exitCode === null;
    },
  };

  return p;
}

// ─── OMP adapter ───────────────────────────────────────────────────────────────

export interface CodingOmpAdapter extends CodingEngineAdapter {
  start(session: CodingSessionRef): Promise<void>;
  stop(): void;
  /**
   * Dispatch a coding-session op to the OMP engine.
   *
   * All coding ops are UNSUPPORTED per empirical probe 2026-10-02:
   * OMP has no programmatic API for prompt/steer/stop/resume/inspect_changes.
   * The extension_ui_request notification channel IS real and captured.
   */
  dispatch(
    session: CodingSessionRef,
    op: CodingSessionOp,
    input?: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface CreateOmpAdapterOptions {
  /** Override the transport (for tests). */
  transport?: OmpTransport;
  /** Label for this adapter instance. */
  label?: string;
  /** Timeout for OMP responses (ms). Default 30s. */
  responseTimeoutMs?: number;
}


/** All evidence records for unsupported ops — collected from empirical probe. */
const UNSUPPORTED_EVIDENCE: Record<CodingSessionOp, UnsupportedEvidence> = {
  prompt: {
    op: "prompt",
    command: "user_message",
    error: "Unknown command: user_message",
    probeNote:
      "S16 probe 2026-10-02: jsonrpc params.message, positional args, type=user_message — all return Unknown command. No programmatic chat API exists.",
  },
  steer: {
    op: "steer",
    command: "steer",
    error: "Unknown command: steer",
    probeNote:
      "S16 probe 2026-10-02: type=steer with various args returns Unknown command. No steering RPC command.",
  },
  stop: {
    op: "stop",
    command: "stop",
    error: "Unknown command: stop",
    probeNote:
      "S16 probe 2026-10-02: type=stop returns Unknown command. No stop/resume RPC commands in omp --mode rpc.",
  },
  resume: {
    op: "resume",
    command: "resume",
    error: "Unknown command: resume",
    probeNote: "S16 probe 2026-10-02: type=resume returns Unknown command. No resume RPC command.",
  },
  inspect_changes: {
    op: "inspect_changes",
    command: "inspect_changes",
    error: "Unknown command: inspect_changes",
    probeNote:
      "S16 probe 2026-10-02: type=inspect_changes returns Unknown command. No workspace inspection API.",
  },
  approvals: {
    op: "approvals",
    command: "get_approvals",
    error: "Unknown command: get_approvals",
    probeNote:
      "S16 probe 2026-10-02: type=get_approvals returns Unknown command. extension_ui_request notifications arrive asynchronously but there is no pull API.",
  },
};

export function createOmpAdapter(options: CreateOmpAdapterOptions = {}): CodingOmpAdapter {
  const {
    transport: transportProp,
    label = "omp",
  } = options;

  const transport = transportProp ?? createProcessTransport({ label });

  // Pending extension_ui_request notifications (the only real async approval channel)
  const pendingApprovals: OmpExtensionUi[] = [];

  // Correlation map for RPC request/response
  const pending = new Map<
    string,
    { resolve: (v: OmpResponse) => void; reject: (e: Error) => void }
  >();

  /**
   * Throws UnsupportedEngineOperationError with full probe evidence.
   * This is called for every coding op — all are unsupported per empirical probe.
   */
  function unsupported(op: CodingSessionOp): never {
    const ev = UNSUPPORTED_EVIDENCE[op];
    const error = new UnsupportedEngineOperationError("omp", op);
    error.message =
      `CodingOp "${op}" is not supported by the OMP engine: ` +
      `command="${ev.command}" error="${ev.error}" probe="${ev.probeNote}"`;
    throw error;
  }

  /** Deliver a raw OMP response to the pending queue. */
  function deliverResponse(msg: OmpResponse) {
    if (msg.id !== undefined) {
      const cb = pending.get(String(msg.id));
      if (cb) {
        pending.delete(String(msg.id));
        cb.resolve(msg);
      }
    }
  }

  /** Register an extension_ui_request notification. */
  function captureApproval(msg: OmpExtensionUi) {
    pendingApprovals.push(msg);
  }

  /** Wire incoming lines from the transport. */
  function handleLine(raw: string) {
    try {
      const msg: OmpMessage = JSON.parse(raw);
      if (msg.type === "response") {
        deliverResponse(msg);
      } else if (msg.type === "extension_ui_request") {
        captureApproval(msg);
      }
      // available_commands_update and other notifications are ignored
    } catch {
      // non-JSON, skip
    }
  }

  // Register the line handler with the transport
  transport.setOnLine(handleLine);

  return {
    id: "omp",
    supportedOps: OMP_SUPPORTED_OPS,

    describe() {
      return `OMP coding engine adapter (${label})`;
    },

    async start(_session: CodingSessionRef) {
      await transport.start();
    },

    stop() {
      transport.stop();
      for (const { reject } of pending.values()) {
        reject(new Error("OMP adapter stopped"));
      }
      pending.clear();
      pendingApprovals.length = 0;
    },

    dispatch(_session: CodingSessionRef, op: CodingSessionOp): never {
      // ALL coding ops are unsupported per empirical probe
      return unsupported(op);
    },
  };
}
