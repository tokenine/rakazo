/**
 * 004-code-mode T25 — OMP engine adapter.
 *
 * Based on T24 findings: `omp --mode rpc` is an interactive JSONL/JSON-RPC 2.0 stdio
 * session (protocol v1, maxFrameBytes 1MB, maxReassembled 64MB). It is NOT a
 * callable RPC daemon — it is a session-mode tool expecting interactive commands.
 * Builtin bash/edit tools require confirmation in interactive mode (Q2/G11 answer:
 * they are routed through the approval surface, not auto-approved for unattended runs).
 *
 * This adapter spawns `omp --mode rpc` as a child process inside the task sandbox
 * and bridges the Pi coding-session interface to OMP's JSONL stdio protocol.
 * Engine-internal state (OMP's conversation context) is never translated across
 * engines — it lives and dies with the subprocess.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { CodingEngineAdapter, CodingSessionOp, CodingSessionRef } from "./coding-engine.js";

export const OMP_SUPPORTED_OPS: ReadonlySet<CodingSessionOp> = new Set<CodingSessionOp>([
  "prompt",
  "steer",
  "stop",
  "resume",
  "inspect_changes",
  "approvals",
]);

/** OMP JSONL message shapes we handle (subset of the protocol). */
interface OmpReady {
  type: "ready";
  protocolVersion: number;
  maxFrameBytes: number;
  maxReassembledBytes: number;
}

interface OmpResponse {
  id?: string | number;
  type: "response";
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

type OmpMessage = OmpReady | OmpResponse | OmpExtensionUi;

/** The subprocess handle held for the lifetime of an OMP session. */
export interface OmpProcess {
  /** Send a JSONL line to OMP's stdin. */
  send(line: string): void;
  /** Read one JSONL line from OMP's stdout. Resolves to null on EOF. */
  receive(): Promise<string | null>;
  /** Terminate the subprocess. */
  close(): void;
  /** Whether the subprocess is still running. */
  alive: boolean;
}

/** OMP adapter for the coding session interface. */
export interface CodingOmpAdapter extends CodingEngineAdapter {
  /** Spawn the OMP subprocess. Idempotent — only one process per adapter instance. */
  start(session: CodingSessionRef): Promise<void>;
  /** Stop the subprocess and release resources. */
  stop(): void;
  /**
   * Dispatch a coding-session op to the OMP engine.
   * prompt/steer: via OMP JSONL stdio protocol (Q2/G11 routed through approval surface).
   * resume/stop/inspect_changes/approvals: local lifecycle / workspace state.
   * Engine-internal OMP state never crosses — it lives and dies with the subprocess.
   */
  dispatch(session: CodingSessionRef, op: CodingSessionOp, input?: Record<string, unknown>): Promise<unknown>;
}

export interface CreateOmpAdapterOptions {
  /** Label for this adapter instance (for logging). */
  label?: string;
  /** Timeout for receiving a response from OMP (ms). Default 30s. */
  responseTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createOmpAdapter(options: CreateOmpAdapterOptions = {}): CodingOmpAdapter {
  const label = options.label ?? "omp";
  const timeoutMs = options.responseTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  let proc: OmpProcess | null = null;
  const pending = new Map<
    string | number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  async function ensureStarted(_session: CodingSessionRef): Promise<void> {
    if (proc) return;
    proc = await spawnOmp(timeoutMs);
    void dispatchLoop();
  }

  async function dispatchLoop() {
    if (!proc) return;
    while (proc.alive) {
      const raw = await Promise.race([proc.receive(), sleep(timeoutMs).then(() => null)]);
      if (raw === null) break;
      try {
        const msg: OmpMessage = JSON.parse(raw);
        if (msg.type === "response" && msg.id !== undefined) {
          const cb = pending.get(msg.id);
          if (cb) {
            pending.delete(msg.id);
            if (msg.success) cb.resolve(msg.result);
            else cb.reject(new Error(msg.error ?? "OMP error"));
          }
        }
        // extension_ui_request messages surface as approvals via the adapter state
      } catch {
        // non-JSON, skip
      }
    }
  }

  function _call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!proc) return Promise.reject(new Error("OMP process not started"));
    return new Promise<unknown>((resolve, reject) => {
      const id = randomUUID();
      pending.set(id, { resolve, reject });
      proc!.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      setTimeout(() => {
        if (pending.delete(id))
          reject(new Error(`OMP call "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  return {
    id: "omp",
    supportedOps: OMP_SUPPORTED_OPS,
    describe() {
      return `OMP coding engine adapter (${label})`;
    },

    async start(session: CodingSessionRef) {
      await ensureStarted(session);
    },

    stop() {
      proc?.close();
      proc = null;
      for (const { reject } of pending.values()) {
        reject(new Error("OMP adapter stopped"));
      }
      pending.clear();
    },

    async dispatch(
      _session: CodingSessionRef,
      op: CodingSessionOp,
      _input?: Record<string, unknown>,
    ): Promise<unknown> {
      // T25: wire prompt/steer/stop/resume/inspect/approvals to the OMP JSONL protocol.
      // Engine-internal state never crosses — OMP's conversation context is opaque to us.
      // For now the adapter maintains start/stop lifecycle; dispatch is a no-op stub
      // until the steering + approval surface is wired in the next slice.
      // The _call helper is available for wiring once inspect_changes and approvals
      // are implemented on the OMP side.
      switch (op) {
        case "stop":
          this.stop();
          return { stopped: true };
        case "resume":
          // OMP is session-mode — resume is a no-op at the adapter level.
          // The session state lives inside the OMP subprocess; we keep it alive.
          return { resumed: true };
        case "inspect_changes":
          // TODO(T25): wire to workspace diff via OMP tooling
          return { changes: [] };
        case "approvals":
          // TODO(T25): surface pending extension_ui_request messages
          return { pending: [] };
        default:
          // prompt and steer: OMP handles these via its own conversation protocol.
          // They require the process to be alive and the OMP session to be ready.
          // _call("user_message", { message }) would be the primitive here.
          return { ok: true };
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Spawn `omp --mode rpc` and resolve once the ready message arrives. */
async function spawnOmp(timeoutMs: number): Promise<OmpProcess> {
  let settled = false;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  let resolveSpawn!: (p: OmpProcess) => void;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  let rejectSpawn!: (e: Error) => void;
  const spawnPromise = new Promise<OmpProcess>((res, rej) => {
    resolveSpawn = res;
    rejectSpawn = rej;
  });

  const proc = spawn("omp", ["--mode", "rpc"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  if (!proc.stdout || !proc.stdin) {
    rejectSpawn(new Error("failed to spawn omp: stdio not available"));
    return spawnPromise as Promise<OmpProcess>;
  }

  const buf = { lines: [] as string[], cur: "" };

  proc.stdout.on("data", (chunk: Buffer) => {
    buf.cur += chunk.toString();
    let newline = buf.cur.indexOf("\n");
    while (newline !== -1) {
      buf.lines.push(buf.cur.slice(0, newline));
      buf.cur = buf.cur.slice(newline + 1);
      newline = buf.cur.indexOf("\n");
    }
  });

  proc.on("error", (err) => {
    if (!settled) {
      settled = true;
      rejectSpawn(err);
    }
  });

  const ticker = setInterval(() => {
    while (buf.lines.length > 0) {
      const raw = buf.lines.shift()!;
      try {
        const msg: OmpMessage = JSON.parse(raw);
        if (msg.type === "ready") {
          clearInterval(ticker);
          const p: OmpProcess = {
            send(line) {
              if (proc.stdin?.writable) proc.stdin.write(`${line}\n`);
            },
            receive() {
              return new Promise<string | null>((res) => {
                const t = setInterval(() => {
                  if (buf.lines.length > 0) {
                    clearInterval(t);
                    res(buf.lines.shift()!);
                  } else if (proc.killed || proc.exitCode !== null) {
                    clearInterval(t);
                    res(null);
                  }
                }, 10);
              });
            },
            close() {
              proc.kill();
            },
            get alive() {
              return !proc.killed && proc.exitCode === null;
            },
          };
          if (!settled) {
            settled = true;
            resolveSpawn(p);
          }
          return;
        }
      } catch {
        // non-JSON line, skip
      }
    }
  }, 10);

  proc.on("close", () => {
    clearInterval(ticker);
    if (!settled) {
      settled = true;
      rejectSpawn(new Error("omp --mode rpc exited before sending ready"));
    }
  });

  setTimeout(() => {
    clearInterval(ticker);
    if (!settled) {
      settled = true;
      rejectSpawn(new Error(`omp --mode rpc did not emit ready within ${timeoutMs}ms`));
    }
  }, timeoutMs);

  return spawnPromise;
}
