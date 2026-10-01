import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRunRequest, ConnectorTool } from "@rakazo/adapter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";
import { LocalAgentHomeStore } from "./home.js";

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

/**
 * 004-code-mode T12 (V4) — executor-level proof that ALL FOUR unguarded
 * handlers (shell, write_file, schedule_create, add_mcp_server) settle or
 * block during a takeover hold using the existing heldForTakeover guard
 * pattern, and that a resume after a takeover carries the pre-resume
 * workspace recheck (manual edits during the hold are protected, never
 * implied rolled back).
 */

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const TOOL_ARGS: Record<string, Record<string, unknown>> = {
  shell: { command: "echo hi" },
  write_file: { path: "notes/x.txt", content: "hi" },
  schedule_create: { name: "routine", prompt: "ping", every: 5, unit: "minutes" },
  add_mcp_server: { name: "srv", transport: "streamable_http", endpoint: "https://mcp.example" },
};

function fixture(options: {
  runStatus: string;
  checkpoint?: string | null;
  toolName: string;
  home?: LocalAgentHomeStore;
  computer?: Record<string, unknown>;
}) {
  const tool: ConnectorTool = {
    name: options.toolName,
    description: "guarded tool",
    inputSchema: { type: "object", properties: {} },
    route: { connectorId: "demo", resourceId: "r", toolName: options.toolName },
  };
  const toolName = tool.name;
  const results: unknown[] = [];
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: options.runStatus,
    trigger: "user",
    leaseFence: 0,
    checkpoint: options.checkpoint ?? null,
  };
  const prisma = {
    run: {
      findUnique: vi.fn(async () => ({ ...run })),
      findUniqueOrThrow: vi.fn(async () => ({ ...run })),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(run, data);
        return { count: 1 };
      }),
    },
    bot: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.botId,
        name: "Assistant",
        title: "Assistant",
        description: "",
        computerId: "computer-1",
        computer: options.computer ?? { id: "computer-1", scope: "dedicated" },
      })),
      findMany: vi.fn(async () => []),
    },
    attempt: {
      create: vi.fn(async () => ({ id: "attempt-1" })),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    thread: { findUniqueOrThrow: vi.fn(async () => ({ id: run.threadId, groupId: null })) },
    message: { findMany: vi.fn(async () => []) },
    task: { findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: "work" })) },
    connection: { findMany: vi.fn(async () => []) },
    spaceModelPreference: { findFirst: vi.fn(async () => null) },
    userModelCredential: { findFirst: vi.fn(async () => null) },
    deploymentSettings: {
      findUnique: vi.fn(async () => ({
        defaultModelProvider: "scripted",
        defaultModelId: "scripted",
      })),
    },
    taughtSkill: { findMany: vi.fn(async () => []) },
    agentSecret: { findMany: vi.fn(async () => []) },
    agentSkill: { findMany: vi.fn(async () => []) },
    scratchpadItem: { findMany: vi.fn(async () => []) },
    actionApprovalRule: { findMany: vi.fn(async () => []) },
    actionAutoReviewPreference: { findUnique: vi.fn(async () => ({ enabled: false })) },
    externalEffect: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: "effect-1",
      })),
      update: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  let seenPrompt: string | undefined;
  const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
    seenPrompt = request.prompt;
    if (toolName) {
      const result = await request.executeTool!(toolName, TOOL_ARGS[toolName] ?? {}, "call-1");
      results.push(result);
    }
    yield { type: "done" as const, text: "Done" };
  });
  const executor = createRunExecutor({
    prisma,
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    connector: {
      discoverTools: async () => [tool],
      resolveCall: async () => undefined,
      execute: vi.fn(async function* () {
        yield { type: "result" as const, data: {} };
      }),
    },
    sandbox: {
      describe: () => ({ capabilities: { graphical: false } }),
      writeFile: vi.fn(async () => undefined),
      execute: async function* () {
        yield { type: "exit" as const, code: 0 };
      },
      readFile: async () => new TextEncoder().encode("x"),
    },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    home: options.home,
    events: {
      append: vi.fn(async () => undefined),
      pauseRunForInput: vi.fn(async () => {
        run.status = "waiting_input";
        return true;
      }),
      finalizeRun: vi.fn(async () => ({ continuationRunId: null })),
    },
    jobs: { enqueue: vi.fn(async () => undefined) },
    secrets: [],
    shutdownSignal: undefined,
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  return {
    results,
    prompt: () => seenPrompt,
    async run() {
      await executor.continueRun(run.id, "worker-1");
    },
  };
}

describe("takeover hold: the four guarded handlers settle or block (V4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  for (const toolName of ["shell", "write_file", "schedule_create", "add_mcp_server"]) {
    it(`${toolName}: blocked with an explicit recorded error while the user holds the screen`, async () => {
      const f = fixture({ runStatus: "waiting_takeover", checkpoint: null, toolName });
      await f.run();
      expect(f.results).toHaveLength(1);
      const result = f.results[0] as { error?: string };
      expect(result.error).toBeTruthy();
      expect(result.error).toMatch(new RegExp(toolName));
      expect(result.error).toMatch(/takeover/i);
      expect(result.error).toMatch(/held|blocked/i);
    });
  }

  it("the same handlers work normally when no takeover hold is active (control)", async () => {
    const f = fixture({ runStatus: "queued", checkpoint: null, toolName: "write_file" });
    await f.run();
    const result = f.results[0] as { error?: string };
    expect(result.error).toBeUndefined();
  });
});

describe("pre-resume recheck note reaches the continuation prompt (V4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("manual edits made during the takeover are reported as protected, not rolled back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-exec-recheck-"));
    dirs.push(root);
    const home = new LocalAgentHomeStore(root);
    const staging = await mkdtemp(path.join(tmpdir(), "rakazo-exec-recheck-src-"));
    dirs.push(staging);
    await (await import("node:fs/promises")).writeFile(
      path.join(staging, "a.txt"),
      "committed",
      "utf8",
    );
    const baseline = await home.commit("bot-1", staging, {
      operationId: "t",
      traceId: "t",
      spaceId: "s",
      userId: "u",
      signal: new AbortController().signal,
    });
    // Manual edit while held, then checkpointed.
    await (await import("node:fs/promises")).writeFile(
      path.join(staging, "a.txt"),
      "manual edit",
      "utf8",
    );
    await home.commit("bot-1", staging, {
      operationId: "t",
      traceId: "t",
      spaceId: "s",
      userId: "u",
      signal: new AbortController().signal,
    });

    const f = fixture({
      runStatus: "queued",
      checkpoint: "takeover",
      toolName: "write_file",
      home,
      computer: {
        id: "computer-1",
        scope: "dedicated",
        homeKey: "bot-1",
        homeRevision: baseline,
      },
    });
    await f.run();
    const prompt = f.prompt();
    expect(prompt).toMatch(/workspace recheck/i);
    expect(prompt).toMatch(/protected/i);
    expect(prompt).toMatch(/not implied/i);
  });

  it("a clean baseline resumes without a protection note", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-exec-recheck2-"));
    dirs.push(root);
    const home = new LocalAgentHomeStore(root);
    const staging = await mkdtemp(path.join(tmpdir(), "rakazo-exec-recheck2-src-"));
    dirs.push(staging);
    await (await import("node:fs/promises")).writeFile(path.join(staging, "a.txt"), "same", "utf8");
    const baseline = await home.commit("bot-1", staging, {
      operationId: "t",
      traceId: "t",
      spaceId: "s",
      userId: "u",
      signal: new AbortController().signal,
    });
    const f = fixture({
      runStatus: "queued",
      checkpoint: "takeover",
      toolName: "write_file",
      home,
      computer: {
        id: "computer-1",
        scope: "dedicated",
        homeKey: "bot-1",
        homeRevision: baseline,
      },
    });
    await f.run();
    expect(f.prompt()).not.toMatch(/protected/i);
  });
});
