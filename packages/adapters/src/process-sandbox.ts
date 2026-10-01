/**
 * 004-code-mode T9 — per-task process-level runtime (Q9 FINAL r2, option 3).
 *
 * A NEW sandbox provider behind the existing seam: one task context per coding
 * task, each with dedicated id-prefixed workspace and data trees, spawn-time
 * resource limits (cpu time, address space, nproc, file size; nice), and an
 * env scrub at spawn (process-env-scrub.ts) — only the allowlist plus the task
 * config's declared vars pass.
 *
 * Threat model (D-Q9 — binding): this provider guards ACCIDENTS and resource
 * conflicts on trusted user code. It is NOT hostile-code containment and no
 * container-grade isolation is claimed anywhere; the doctor states the same.
 *
 * Lifecycle (D-Q9): the task context is created at session start from the
 * setup definition; idle-suspend stops the task (kills the process group) and
 * RETAINS the workspace/data trees; resume recreates the runtime and
 * reattaches the same trees (the G2 versioned workspace store owns history).
 *
 * Collision policy hooks (V3, exercised by the T10 fixture matrix): dynamic
 * port binding with retry (allocatePort), id-prefixed trees, per-task process
 * group naming (cm-<taskId>), and namespaced service/db names
 * (namespacedServiceName).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerFileEntry,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  ScreenSession,
} from "@rakazo/adapter-kit";
import { boundedSandboxCommandTimeoutMs } from "@rakazo/core";
import {
  applyPlaceholderAction,
  boundedComputerActions,
  normalizeWorkspacePath,
  placeholderObservation,
} from "./computer-support.js";
import { scrubProcessEnv } from "./process-env-scrub.js";
import { settleForTakeover, TAKEOVER_SETTLE_BOUND_MS } from "./takeover-settle.js";

/** Spawn-time resource limits (D-Q9): defaults the doctor also verifies. */
export interface ProcessTaskLimits {
  cpuSeconds: number;
  addressSpaceKb: number;
  maxProcesses: number;
  fileSizeBlocks: number;
  nice: number;
}

export const DEFAULT_PROCESS_TASK_LIMITS: Readonly<ProcessTaskLimits> = {
  cpuSeconds: 600,
  addressSpaceKb: 2_097_152,
  // RLIMIT_NPROC counts ALL same-UID processes on the box (desktop stack,
  // other bots, build workers), so the default must leave shared headroom:
  // 512 starved `fork` mid-run on the team box ("fork: retry: resource
  // temporarily unavailable") and took unrelated tasks down with it.
  maxProcesses: 4096,
  fileSizeBlocks: 131_072,
  nice: 5,
};

/**
 * The setup definition a session hands the driver at start (the full Q7 setup
 * format lands in S5/T27; this is the runtime-facing shape it feeds today).
 */
export interface ProcessTaskSetupDefinition {
  taskId: string;
  /** Declared task-config env vars — the only extras that pass the scrub. */
  env?: Record<string, string>;
  /** Resource-limit overrides; unspecified keys fall back to the defaults. */
  limits?: Partial<ProcessTaskLimits>;
}

export interface ProcessTaskContext {
  taskId: string;
  ref: ComputerRef;
  workspaceDir: string;
  dataDir: string;
  processGroupName: string;
  limits: ProcessTaskLimits;
  env: Record<string, string>;
  running: boolean;
  screen: string;
}

export interface AllocatedPort {
  port: number;
  /** The probe socket is already released; kept for symmetric teardown. */
  close: () => Promise<void>;
}

const MAX_PORT_ALLOCATION_ATTEMPTS = 5;

/**
 * Bounded wait for a SIGKILLed process group to actually empty (MED-1):
 * kill(-pgid, 0) is the emptiness check; the bound only elapses when a member
 * refuses to die (e.g. D-state), in which case the pgid stays remembered.
 */
const PROCESS_GROUP_SETTLE_MS = 2_000;

export function isValidTaskId(taskId: string): boolean {
  return (
    taskId.length > 0 &&
    taskId.length <= 128 &&
    taskId !== "." &&
    taskId !== ".." &&
    !taskId.includes("/") &&
    !taskId.includes("\\") &&
    !taskId.includes("..")
  );
}

/** Per-task process-group name (V3 class: process names). */
export function processGroupNameFor(taskId: string): string {
  return `cm-${taskId}`;
}

/** Directory names are id-prefixed so two tasks can never share a tree. */
export function taskWorkspaceDirName(taskId: string): string {
  return `cm-${taskId}-workspace`;
}

export function taskDataDirName(taskId: string): string {
  return `cm-${taskId}-data`;
}

/** Service/db-name namespace helper (V3 class: service/db names). */
export function namespacedServiceName(taskId: string, name: string): string {
  const sanitize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "x";
  return `cm_${sanitize(taskId)}_${sanitize(name)}`;
}

export class ProcessSandboxProvider implements SandboxProvider {
  readonly tasks = new Map<string, ProcessTaskContext>();
  private readonly children = new Map<string, ChildProcess[]>();
  /**
   * Pgids remembered per task (MED-1): each detached wrapper LEADS its own
   * process group (pgid = wrapper pid), and that group OUTLIVES the wrapper
   * while any member — e.g. a daemon the command backgrounded — is still
   * alive. The pgid is therefore remembered here even after execute() forgets
   * the wrapper child; otherwise suspend() could only kill wrappers it still
   * tracked and backgrounded daemons would survive stop/destroy. Stale
   * (empty) pgids are pruned on sight in liveTaskCount/suspend.
   */
  private readonly taskPgids = new Map<string, Set<number>>();

  constructor(private readonly opts: { root?: string } = {}) {}

  describe() {
    return {
      id: "process",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: false,
        pty: false,
        snapshots: false,
        takeover: false,
        persistentHome: true,
        multiScreen: false,
      },
    };
  }

  private rootDir(): string {
    return this.opts.root ?? path.join(process.cwd(), "data", "code-mode-tasks");
  }

  /**
   * Creates the task context at session start from the setup definition:
   * id-prefixed workspace/data trees, recorded limits, env contract.
   */
  async createTaskContext(setup: ProcessTaskSetupDefinition): Promise<ProcessTaskContext> {
    const taskId = setup.taskId;
    if (!isValidTaskId(taskId)) {
      throw new Error(
        `Invalid task id ${JSON.stringify(taskId)}: cannot form a safe directory name`,
      );
    }
    const existing = this.tasks.get(taskId);
    if (existing) return existing;
    const root = this.rootDir();
    const workspaceDir = path.join(root, taskWorkspaceDirName(taskId));
    const dataDir = path.join(root, taskDataDirName(taskId));
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    const context: ProcessTaskContext = {
      taskId,
      ref: {
        id: `process-${taskId}`,
        botId: taskId,
        kind: "process",
        providerRef: workspaceDir,
        fresh: true,
      },
      workspaceDir: await realpath(workspaceDir),
      dataDir: await realpath(dataDir),
      processGroupName: processGroupNameFor(taskId),
      limits: { ...DEFAULT_PROCESS_TASK_LIMITS, ...setup.limits },
      env: { ...setup.env },
      // The runtime starts with the session (D-Q9 lifecycle): creation is start.
      running: true,
      screen: "ready",
    };
    this.tasks.set(taskId, context);
    return context;
  }

  taskContext(computer: ComputerRef): ProcessTaskContext | undefined {
    return this.tasks.get(taskIdOf(computer));
  }

  /**
   * 1 while the task has a live process, else 0 (suspend/settle evidence).
   * Counts tracked wrapper children AND remembered pgids (MED-1): a group
   * whose wrapper already exited still holds live work (a backgrounded
   * daemon). Stale pgids (empty groups) are pruned on sight.
   */
  liveTaskCount(computer: ComputerRef): number {
    const taskId = taskIdOf(computer);
    const children = this.children.get(taskId) ?? [];
    if (children.some((child) => child.exitCode === null && child.signalCode === null)) return 1;
    const pgids = this.taskPgids.get(taskId);
    if (pgids) {
      for (const pgid of [...pgids]) {
        try {
          process.kill(-pgid, 0);
          return 1; // group alive: at least one member still exists
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === "EPERM") return 1;
          pgids.delete(pgid); // ESRCH: group gone — prune the stale pgid
        }
      }
    }
    return 0;
  }

  /**
   * Allocates or reconnects the task runtime. After a suspend/stop, a fresh
   * ref is returned (fresh: true) while the SAME trees are reattached.
   */
  async provision(
    request: { botId: string; homePath: string; providerRef?: string; providerKind?: string },
    _context: AdapterContext,
  ): Promise<ComputerRef> {
    const taskId = request.providerRef ?? request.botId;
    let task = this.tasks.get(taskId);
    if (!task) task = await this.createTaskContext({ taskId });
    const wasRunning = task.running;
    task.running = true;
    return { ...task.ref, fresh: !wasRunning };
  }

  async prepare(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const task = this.requiredTask(computer);
    await mkdir(task.workspaceDir, { recursive: true });
    await mkdir(task.dataDir, { recursive: true });
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const task = this.requiredTask(computer);
    if (!task.running) {
      yield { type: "stderr", data: `task ${task.taskId} is not running (suspended or stopped)` };
      yield { type: "exit", code: 1 };
      return;
    }
    const cwd = await this.containedCwd(task, request.cwd);
    if (cwd === null) {
      yield { type: "stderr", data: "cwd is outside this task's workspace" };
      yield { type: "exit", code: 1 };
      return;
    }
    const argv = request.argv.length > 0 ? request.argv : ["echo", "ready"];
    const limits = task.limits;
    // Limits are &&-chained: a ulimit the box refuses must fail the command
    // loudly — never silently continue with partial resource limits.
    const preamble =
      process.platform === "win32"
        ? 'exec "$@"'
        : [
            `ulimit -t ${limits.cpuSeconds}`,
            `ulimit -v ${limits.addressSpaceKb}`,
            `ulimit -u ${limits.maxProcesses}`,
            `ulimit -f ${limits.fileSizeBlocks}`,
            `exec nice -n ${limits.nice} "$@"`,
          ].join(" && ");
    // Driver-injected per-task identity (process-group naming, V3 class).
    // These are runtime metadata ordered UNDER the task's declared vars —
    // never parent env leakage: the scrub still drops every undeclared
    // parent variable.
    const childEnv = {
      CODE_MODE_TASK_ID: task.taskId,
      CODE_MODE_TASK_GROUP: task.processGroupName,
      ...scrubProcessEnv(process.env, { ...task.env, ...request.env }),
    };
    const child = spawn("bash", ["-c", preamble, processGroupNameFor(task.taskId), ...argv], {
      cwd,
      env: childEnv,
      // detached: each task becomes its own process group (pgid = wrapper
      // pid), so suspend/stop kills exactly this task's tree (V3 class).
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.trackChild(task.taskId, child);
    // Detached spawn: the wrapper pid IS the task's process group; remember it
    // so suspend/destroy can kill the group even after this wrapper exits
    // (MED-1 — backgrounded daemons outlive the wrapper in the same pgid).
    this.rememberTaskPgid(task.taskId, child.pid);
    let stdout = "";
    let stderr = "";
    const timeoutMs = boundedSandboxCommandTimeoutMs(request.timeoutMs);
    try {
      // T12 settle wiring (LOW-1): the run's abort signal IS the takeover
      // signal for an in-flight sandbox command. settleForTakeover supplies
      // the bounded-wait + recorded-exit semantics: the exit event is yielded
      // only after the child REALLY closed (completed — its true exit code),
      // or, when no confirmed close arrives within the bound, as a
      // settled-timeout whose exit is recorded unconfirmed instead of a
      // fabricated instant code. The settle bound rides above the command's
      // own timeout, so ordinary (non-aborted) commands always settle first
      // and win the race.
      const settlement = await settleForTakeover(
        (settleSignal) =>
          new Promise<{ code: number }>((resolve) => {
            let settled = false;
            const finish = (code: number) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve({ code });
            };
            const killTree = () => {
              if (child.pid === undefined) return;
              try {
                process.kill(-child.pid, "SIGKILL");
              } catch {
                try {
                  child.kill("SIGKILL");
                } catch {
                  // Already gone.
                }
              }
            };
            const onAbort = () => {
              killTree();
              stderr += "command aborted\n";
              finish(130);
            };
            const timer = setTimeout(() => {
              killTree();
              stderr += `command timed out after ${timeoutMs} ms\n`;
              finish(124);
            }, timeoutMs);
            timer.unref?.();
            settleSignal.addEventListener("abort", onAbort, { once: true });
            child.stdout?.on("data", (chunk: Buffer) => {
              stdout += chunk.toString("utf8");
            });
            child.stderr?.on("data", (chunk: Buffer) => {
              stderr += chunk.toString("utf8");
            });
            child.on("error", (error) => {
              stderr += error.message;
              finish(1);
            });
            child.on("close", (code, signal) => {
              if (signal) {
                stderr += `command terminated by ${signal}\n`;
                finish(signal === "SIGKILL" ? 137 : signal === "SIGTERM" ? 143 : 1);
                return;
              }
              finish(code ?? 0);
            });
          }),
        {
          takeover: context.signal,
          // Above the command's own timeout: the utility's bound must never
          // fire before the command's own timer does; it only trips when the
          // child never confirms close even after SIGKILL (e.g. a group
          // member still holding the stdio pipes) — then the exit is
          // recorded unconfirmed instead of implied clean.
          boundMs: timeoutMs + TAKEOVER_SETTLE_BOUND_MS,
        },
      );
      if (stdout) yield { type: "stdout", data: stdout };
      if (stderr) yield { type: "stderr", data: stderr };
      if (settlement.outcome === "settled-timeout") {
        // Recorded exit (V4 "settled … or blocked"): the command was
        // signalled but never confirmed its close within the bounded settle
        // wait — record the exit as unconfirmed, never as a clean kill.
        yield {
          type: "stderr",
          data: `command aborted; exit unconfirmed after ${Math.round(settlement.waitedMs)} ms (takeover settle bound)`,
        };
        yield { type: "exit", code: 130 };
      } else {
        yield { type: "exit", code: settlement.value?.code ?? 130 };
      }
    } finally {
      this.forgetChild(task.taskId, child);
    }
  }

  /**
   * Idle-suspend: stop the task's processes; trees are retained (D-Q9/R9).
   * Kills the tracked wrapper groups AND every remembered pgid (MED-1) —
   * daemons backgrounded by wrappers that already exited live on in the
   * task's group — then verifies each remembered group emptied (bounded):
   * a kill(-pgid, 0) that still succeeds means a member survived, and that
   * pgid stays remembered so liveTaskCount keeps reporting it and the next
   * suspend/destroy retries.
   */
  async suspend(computer: ComputerRef): Promise<void> {
    const task = this.requiredTask(computer);
    for (const child of this.children.get(task.taskId) ?? []) {
      if (child.pid === undefined || child.exitCode !== null) continue;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    for (const pgid of [...(this.taskPgids.get(task.taskId) ?? [])]) {
      this.killRememberedPgid(task.taskId, pgid);
    }
    for (const pgid of [...(this.taskPgids.get(task.taskId) ?? [])]) {
      await this.waitProcessGroupEmpty(task.taskId, pgid);
    }
    task.running = false;
  }

  async inspectBackgroundWork(
    _computer: ComputerRef,
    _markerId: string,
    _context: AdapterContext,
  ): Promise<"idle" | "unknown"> {
    return "idle";
  }

  async connectScreen(
    computer: ComputerRef,
    _request: ScreenRequest,
    _context: AdapterContext,
  ): Promise<ScreenSession> {
    this.requiredTask(computer);
    return {
      url: `process://screen/${computer.id}`,
      mimeType: "text/plain",
      close: async () => undefined,
    };
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    _lease: ControlLeaseRef,
    _context: AdapterContext,
  ): Promise<void> {
    applyPlaceholderAction(this.requiredTask(computer), input);
  }

  async observe(computer: ComputerRef, _context: AdapterContext) {
    return placeholderObservation(this.requiredTask(computer).screen);
  }

  async act(computer: ComputerRef, request: ComputerActionRequest, context: AdapterContext) {
    const task = this.requiredTask(computer);
    const actions = boundedComputerActions(request.actions);
    for (const action of actions) applyPlaceholderAction(task, action);
    return {
      completed: actions.length,
      ...(request.observe === false ? {} : { observation: await this.observe(computer, context) }),
    };
  }

  async listFiles(
    computer: ComputerRef,
    directory: string,
    _context: AdapterContext,
  ): Promise<ComputerFileEntry[]> {
    const task = this.requiredTask(computer);
    const relative = normalizeWorkspacePath(directory);
    const target = this.containedPath(task.workspaceDir, relative);
    const entries = await readdir(target, { withFileTypes: true });
    const listed = await Promise.all(
      entries.map(async (entry) => {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const child = this.containedPath(task.workspaceDir, childRelative);
        const info = await stat(child);
        return {
          path: childRelative,
          kind: info.isDirectory() ? ("dir" as const) : ("file" as const),
          size: info.size,
          ...(info.isFile() && info.mode & 0o100 ? { executable: true } : {}),
        };
      }),
    );
    return listed;
  }

  async readFile(
    computer: ComputerRef,
    filePath: string,
    _context: AdapterContext,
    options?: { maxBytes?: number },
  ): Promise<Uint8Array> {
    const task = this.requiredTask(computer);
    const target = this.containedPath(task.workspaceDir, normalizeWorkspacePath(filePath));
    const info = await stat(target);
    if (options?.maxBytes !== undefined && info.size > options.maxBytes) {
      throw new Error(`computer file exceeds ${options.maxBytes} bytes`);
    }
    return new Uint8Array(await readFile(target));
  }

  async writeFile(
    computer: ComputerRef,
    file: PortableFile,
    _context: AdapterContext,
  ): Promise<void> {
    const task = this.requiredTask(computer);
    const relative = normalizeWorkspacePath(file.path);
    if (!relative) throw new Error("Workspace snapshots cannot contain an empty file path");
    const target = this.containedPath(task.workspaceDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    const handle = await open(target, "w", file.executable ? 0o700 : 0o600);
    try {
      await handle.writeFile(file.content);
    } finally {
      await handle.close();
    }
  }

  async *exportWorkspace(
    computer: ComputerRef,
    _context: AdapterContext,
  ): AsyncIterable<PortableFile> {
    const task = this.requiredTask(computer);
    yield* walkWorkspace(task.workspaceDir, "");
  }

  async importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ): Promise<void> {
    for await (const file of files) await this.writeFile(computer, file, context);
  }

  async snapshot(computer: ComputerRef, _context: AdapterContext) {
    this.requiredTask(computer);
    return { id: `process-snap-${computer.id}`, createdAt: new Date().toISOString() };
  }

  async stop(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    await this.suspend(computer);
  }

  async destroy(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const task = this.requiredTask(computer);
    await this.suspend(computer);
    this.children.delete(task.taskId);
    this.taskPgids.delete(task.taskId);
    this.tasks.delete(task.taskId);
    // Workspace/data trees are NEVER deleted here: the versioned workspace
    // store owns history, and a destroyed runtime must not lose user work.
  }

  /**
   * Dynamic port binding with retry (V3 class: listening ports). Probes an
   * ephemeral, kernel-selected port (no fixed ranges) and releases the probe
   * socket so the task process itself can bind it; the hand-off window is
   * exactly what the bounded retry covers. `onAttempt` reports each try.
   *
   * Contract (LOW-3): this call only proves the port was free AT PROBE TIME.
   * The probe is loopback-IPv4-only (127.0.0.1) and the socket is released
   * before returning, so a task-side bind can still lose the race to another
   * opener — that TOCTOU window is inherent without fd passing or
   * SO_REUSEPORT and is NOT closed here. A task-side bind failure (EADDRINUSE)
   * MUST therefore be handled by the caller re-invoking allocatePort with
   * bounded retries; never by falling back to a fixed port.
   */
  async allocatePort(
    options: { onAttempt?: (attempt: number) => void } = {},
  ): Promise<AllocatedPort> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_PORT_ALLOCATION_ATTEMPTS; attempt += 1) {
      options.onAttempt?.(attempt);
      const server = createServer();
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve());
        });
        const address = server.address();
        if (address === null || typeof address === "string") {
          throw new Error("ephemeral port allocation returned no TCP address");
        }
        const port = address.port;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        return {
          port,
          // The probe socket is already released; close stays for symmetric
          // teardown at the caller.
          close: async () => undefined,
        };
      } catch (error) {
        lastError = error;
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    throw new Error(
      `could not allocate an ephemeral port after ${MAX_PORT_ALLOCATION_ATTEMPTS} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  /** Detached spawn ⇒ the wrapper pid is the task process group id (POSIX). */
  private rememberTaskPgid(taskId: string, pid: number | undefined) {
    if (pid === undefined || process.platform === "win32") return;
    const pgids = this.taskPgids.get(taskId) ?? new Set<number>();
    pgids.add(pid);
    this.taskPgids.set(taskId, pgids);
  }

  /** Best-effort SIGKILL of a whole group; prunes the pgid when it is gone. */
  private killRememberedPgid(taskId: string, pgid: number): boolean {
    try {
      process.kill(-pgid, "SIGKILL");
      return true;
    } catch {
      this.taskPgids.get(taskId)?.delete(pgid); // ESRCH: nobody left in the group
      return false;
    }
  }

  /**
   * Bounded verification that a process group emptied: kill(-pgid, 0)
   * succeeding means a member is still alive (SIGKILL is not instantaneous —
   * the kernel needs a scheduling point to reap the members). Returns true
   * when the group is gone (the pgid is pruned); false keeps it remembered
   * so the next suspend/destroy retries.
   */
  private async waitProcessGroupEmpty(taskId: string, pgid: number): Promise<boolean> {
    const deadline = Date.now() + PROCESS_GROUP_SETTLE_MS;
    while (Date.now() < deadline) {
      try {
        process.kill(-pgid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "EPERM") return false;
        this.taskPgids.get(taskId)?.delete(pgid);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  private trackChild(taskId: string, child: ChildProcess) {
    const list = this.children.get(taskId) ?? [];
    list.push(child);
    this.children.set(taskId, list);
  }

  private forgetChild(taskId: string, child: ChildProcess) {
    const list = (this.children.get(taskId) ?? []).filter((entry) => entry !== child);
    if (list.length > 0) this.children.set(taskId, list);
    else this.children.delete(taskId);
  }

  private requiredTask(computer: ComputerRef): ProcessTaskContext {
    const task = this.taskContext(computer);
    if (!task) throw new Error(`Unknown process task for computer ${computer.id}`);
    return task;
  }

  private containedPath(root: string, relative: string): string {
    const resolvedRoot = path.resolve(root);
    const candidate = path.resolve(resolvedRoot, relative);
    const within = candidate === resolvedRoot || candidate.startsWith(`${resolvedRoot}${path.sep}`);
    if (!within) throw new Error("Path escapes the task workspace");
    return candidate;
  }

  /** Returns the contained cwd, or null when the requested cwd escapes. */
  private async containedCwd(task: ProcessTaskContext, requested?: string): Promise<string | null> {
    if (!requested) return task.workspaceDir;
    const candidate = path.resolve(task.workspaceDir, requested);
    try {
      const resolved = await realpath(candidate);
      const within =
        resolved === task.workspaceDir || resolved.startsWith(`${task.workspaceDir}${path.sep}`);
      return within ? resolved : null;
    } catch {
      // Not required to exist yet; lexical containment is enough for spawn cwd.
      const lexical = this.containedPath(task.workspaceDir, requested);
      return lexical === candidate ? candidate : null;
    }
  }
}

function taskIdOf(computer: ComputerRef): string {
  return computer.id.startsWith("process-") ? computer.id.slice("process-".length) : computer.id;
}

async function* walkWorkspace(root: string, relative: string): AsyncIterable<PortableFile> {
  const current = relative ? path.join(root, relative) : root;
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* walkWorkspace(root, childRelative);
    } else if (entry.isFile()) {
      const content = await readFile(path.join(root, childRelative));
      yield { path: childRelative, content: new Uint8Array(content) };
    }
  }
}
