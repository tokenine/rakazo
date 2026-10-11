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
  PtySession,
  SandboxProvider,
  ScreenRequest,
  ScreenSession,
  TerminalRequest,
} from "@rakazo/adapter-kit";
import { canReleaseScreenLease, canTakeScreenLease } from "@rakazo/core";
import { ComputerScreenUnavailableError, screenSessionKey } from "./computer-screens.js";
import {
  applyPlaceholderAction,
  boundedComputerActions,
  normalizeWorkspacePath,
  placeholderObservation,
  workspacePath,
} from "./computer-support.js";
import {
  FakeTerminalGateway,
  type TerminalOpenResult,
} from "./fake-terminal.js";

export interface FakeBox {
  ref: ComputerRef;
  files: Map<string, { content: Uint8Array; executable: boolean }>;
  running: boolean;
  screens: Map<string, string>;
  screenLeases: Map<string, string>;
}

export class FakeSandboxProvider implements SandboxProvider {
  readonly boxes = new Map<string, FakeBox>();
  private readonly terminals = new FakeTerminalGateway();

  describe() {
    return {
      id: "fake",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: true,
        pty: true,
        snapshots: true,
        takeover: true,
        persistentHome: true,
        multiScreen: true,
      },
    };
  }

  async provision(
    request: { botId: string; homePath: string },
    _context: AdapterContext,
  ): Promise<ComputerRef> {
    const id = `fake-${request.botId}`;
    const existing = this.boxes.get(id);
    if (existing) {
      existing.running = true;
      return { ...existing.ref, fresh: false };
    }
    const ref: ComputerRef = {
      id,
      botId: request.botId,
      kind: "fake",
      providerRef: id,
      fresh: true,
    };
    this.boxes.set(ref.id, {
      ref,
      files: new Map(),
      running: true,
      screens: new Map([["default", "ready"]]),
      screenLeases: new Map(),
    });
    return ref;
  }

  async prepare(_computer: ComputerRef, _context: AdapterContext): Promise<void> {}

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    _context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const box = this.boxes.get(computer.id);
    if (!box) {
      yield { type: "stderr", data: "computer not found" };
      yield { type: "exit", code: 1 };
      return;
    }
    // The shell tool wraps the model's command in a background-work launcher; answer the command.
    const wrapped =
      request.argv[3] === "rakazo-background-launch" ? request.argv.at(-1) : undefined;
    const cmd = wrapped ?? request.argv.join(" ");
    if (wrapped?.startsWith("echo ")) {
      yield { type: "stdout", data: `${wrapped.slice(5)}\n` };
    } else if (request.argv[0] === "echo") {
      yield { type: "stdout", data: `${request.argv.slice(1).join(" ")}\n` };
    } else if (cmd.startsWith("cat ")) {
      const file = normalizeWorkspacePath(request.argv[1] ?? "");
      const stored = box.files.get(file);
      yield { type: "stdout", data: stored ? new TextDecoder().decode(stored.content) : "" };
    } else {
      yield { type: "stdout", data: `ran ${cmd}\n` };
    }
    yield { type: "exit", code: 0 };
  }

  async inspectBackgroundWork(
    _computer: ComputerRef,
    _markerId: string,
    _context: AdapterContext,
  ): Promise<"idle"> {
    return "idle";
  }

  async connectScreen(
    computer: ComputerRef,
    _request: ScreenRequest,
    context: AdapterContext,
  ): Promise<ScreenSession> {
    const key = screenSessionKey(context);
    this.screenSlot(this.requiredBox(computer), key, context.screenLeaseId);
    return {
      url: `fake://screen/${computer.id}/${key}`,
      mimeType: "text/plain",
      close: async () => undefined,
    };
  }

  async connectTerminal(
    computer: ComputerRef,
    request: TerminalRequest,
    _context: AdapterContext,
  ): Promise<PtySession> {
    this.requiredBox(computer);
    if (!request.controlToken) throw new Error("terminal requires screen control");

    const cwd = workspacePath("/home/rakazo", request.cwd ?? "");
    const sessionId = request.sessionId;

    // Reconnect to existing session if sessionId is provided and found
    if (sessionId) {
      const existing = this.terminals.attach(sessionId);
      if (existing) return this.buildPtySession(existing);
      // Unknown sessionId → create a new session using that id
      const result = await this.openTerminalWithId(computer.id, request.controlToken, cwd, sessionId);
      return this.buildPtySession(result);
    }

    const result = await this.terminals.open(computer.id, request.controlToken, cwd);
    return this.buildPtySession(result);
  }

  /** Open a terminal using a specific sessionId rather than generating a new UUID. */
  private async openTerminalWithId(
    owner: string,
    lease: string,
    cwd: string,
    sessionId: string,
  ): Promise<TerminalOpenResult> {
    const port = await this.terminals.start();
    this.terminals.sessions.set(sessionId, {
      owner,
      lease,
      cwd,
      cols: 80,
      rows: 24,
      scrollback: [],
    });
    const socketPath = `websockify?token=${sessionId}`;
    const url = `http://127.0.0.1:${port}/vnc.html?path=${encodeURIComponent(socketPath)}`;
    return { sessionId, url, cols: 80, rows: 24, scrollback: [] };
  }

  private buildPtySession(result: TerminalOpenResult): PtySession {
    const sessionId = result.sessionId;
    const terminals = this.terminals;

    // cols/rows are live references into the session state so that resize()
    // is reflected immediately in the returned object
    let cols = result.cols;
    let rows = result.rows;

    return {
      get sessionId() {
        return sessionId;
      },
      url: result.url,
      get cols() {
        const s = terminals.sessions.get(sessionId);
        return s ? s.cols : cols;
      },
      set cols(v: number) {
        cols = v;
      },
      get rows() {
        const s = terminals.sessions.get(sessionId);
        return s ? s.rows : rows;
      },
      set rows(v: number) {
        rows = v;
      },
      scrollback: result.scrollback,
      async resize(dim: { cols: number; rows: number }) {
        terminals.resize(sessionId, dim.cols, dim.rows);
        cols = dim.cols;
        rows = dim.rows;
      },
      async sendInput(_input: { kind: "text"; text: string }) {
        // In-process input injection into a fake terminal is a no-op.
        // The fake terminal only speaks WebSocket, not a named-pipe API.
        // A real provider would write to the PTY master fd (T40: never for
        // viewOnly sessions — the process provider drops those frames).
      },
    };
  }

  /** Releasing control ends that lease's terminal, as on real computers. */
  async setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    _context: AdapterContext,
    controlToken?: string,
  ) {
    if (!interactive) this.terminals.revoke(computer.id, controlToken);
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    _lease: ControlLeaseRef,
    context: AdapterContext,
  ): Promise<void> {
    const box = this.boxes.get(computer.id);
    if (box) {
      applyPlaceholderAction(
        this.screenSlot(box, screenSessionKey(context), context.screenLeaseId),
        input,
      );
    }
  }

  async observe(computer: ComputerRef, context: AdapterContext) {
    const key = screenSessionKey(context);
    return placeholderObservation(
      this.screenSlot(this.requiredBox(computer), key, context.screenLeaseId).screen,
    );
  }

  async act(computer: ComputerRef, request: ComputerActionRequest, context: AdapterContext) {
    const box = this.requiredBox(computer);
    const slot = this.screenSlot(box, screenSessionKey(context), context.screenLeaseId);
    const actions = boundedComputerActions(request.actions);
    for (const action of actions) applyPlaceholderAction(slot, action);
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
    const box = this.requiredBox(computer);
    const normalized = normalizeWorkspacePath(directory);
    const prefix = normalized ? `${normalized}/` : "";
    const entries = new Map<string, ComputerFileEntry>();
    for (const [filePath, file] of box.files) {
      if (!filePath.startsWith(prefix)) continue;
      const remainder = filePath.slice(prefix.length);
      const [name, ...rest] = remainder.split("/");
      if (!name) continue;
      const listedPath = prefix + name;
      entries.set(listedPath, {
        path: listedPath,
        kind: rest.length ? "dir" : "file",
        size: rest.length ? 0 : file.content.byteLength,
        ...(!rest.length && file.executable ? { executable: true } : {}),
      });
    }
    return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(
    computer: ComputerRef,
    filePath: string,
    _context: AdapterContext,
    options?: { maxBytes?: number },
  ) {
    const file = this.requiredBox(computer).files.get(normalizeWorkspacePath(filePath));
    if (!file) throw new Error("computer file not found");
    if (options?.maxBytes !== undefined && file.content.byteLength > options.maxBytes) {
      throw new Error(`computer file exceeds ${options.maxBytes} bytes`);
    }
    return new Uint8Array(file.content);
  }

  async writeFile(computer: ComputerRef, file: PortableFile, _context: AdapterContext) {
    this.requiredBox(computer).files.set(normalizeWorkspacePath(file.path), {
      content: new Uint8Array(file.content),
      executable: file.executable === true,
    });
  }

  async *exportWorkspace(
    computer: ComputerRef,
    _context: AdapterContext,
  ): AsyncIterable<PortableFile> {
    for (const [filePath, file] of [...this.requiredBox(computer).files].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      yield {
        path: filePath,
        content: new Uint8Array(file.content),
        executable: file.executable,
      };
    }
  }

  async importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    _context: AdapterContext,
  ) {
    const box = this.requiredBox(computer);
    for await (const file of files) {
      box.files.set(normalizeWorkspacePath(file.path), {
        content: new Uint8Array(file.content),
        executable: file.executable === true,
      });
    }
  }

  async snapshot(computer: ComputerRef, _context: AdapterContext) {
    return { id: `snap-${computer.id}`, createdAt: new Date().toISOString() };
  }

  async releaseScreen(computer: ComputerRef, context: AdapterContext): Promise<void> {
    const box = this.boxes.get(computer.id);
    if (!box) return;
    const key = screenSessionKey(context);
    const leaseId = box.screenLeases.get(key);
    if (context.screenLeaseId && !canReleaseScreenLease(leaseId, context.screenLeaseId)) return;
    box.screens.delete(key);
    box.screenLeases.delete(key);
  }

  async stop(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const box = this.boxes.get(computer.id);
    if (box) box.running = false;
    this.terminals.revoke(computer.id);
  }

  async destroy(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    this.boxes.delete(computer.id);
    this.terminals.revoke(computer.id);
  }

  private requiredBox(computer: ComputerRef): FakeBox {
    const box = this.boxes.get(computer.id);
    // Named so isSandboxGoneError recognizes it: a box lost across restarts is a
    // gone sandbox, and the API clears the dead computer row instead of 500ing.
    if (!box) {
      throw Object.assign(new Error(`sandbox ${computer.id} is not running`), {
        name: "SandboxNotFoundError",
      });
    }
    return box;
  }

  private screenSlot(box: FakeBox, key: string, leaseId?: string): { screen: string } {
    if (!box.screens.has(key)) box.screens.set(key, `ready:${key}`);
    const current = box.screenLeases.get(key);
    if (leaseId && current && leaseId !== current && !canTakeScreenLease(current, leaseId)) {
      throw new ComputerScreenUnavailableError();
    }
    if (leaseId && canTakeScreenLease(current, leaseId)) box.screenLeases.set(key, leaseId);
    return {
      get screen() {
        return box.screens.get(key) ?? `ready:${key}`;
      },
      set screen(value: string) {
        box.screens.set(key, value);
      },
    };
  }
}
