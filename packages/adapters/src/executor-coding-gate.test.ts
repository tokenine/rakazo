import type { AgentRunRequest, ConnectorCall, ConnectorTool } from "@rakazo/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CODING_READ_ONLY_TOOLS, type CodingAcceptanceGate } from "./coding-acceptance-gate.js";
import { CODING_SESSION_TRIGGER } from "./coding-pi-adapter.js";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

/**
 * Executor-level proof that the coding acceptance gate sits at the tool
 * authorization point (T4): when the gate refuses, the tool call never
 * executes and the model receives the explicit refusal. HIGH-1 fix: the same
 * point FAILS CLOSED for coding_session runs when no gate is installed —
 * only the shared read-only allowlist passes, mutation tools are refused.
 * (Allowlist membership itself is proven against the real gate service in
 * coding-acceptance-gate.test.ts; connector tools cannot shadow builtin
 * names, so the pass-through case rides that shared set.)
 */
function fixture(
  options: { codingGate?: CodingAcceptanceGate; trigger?: string; toolName?: string } = {},
) {
  const tool: ConnectorTool = {
    name: options.toolName ?? "demo_write_item",
    description: "Write an item",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    route: {
      connectorId: "demo",
      resourceId: "resource-1",
      toolName: options.toolName ?? "demo_write_item",
    },
  };
  const toolName = tool.name;
  const executed: ConnectorCall[] = [];
  const results: unknown[] = [];
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger: options.trigger ?? "user",
    leaseFence: 0,
  };
  const prisma = {
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => run),
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
        computer: { id: "computer-1", scope: "dedicated" },
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
    task: { findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: "write it" })) },
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
  const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
    const result = await request.executeTool!(toolName, { id: "item-1" }, "call-1");
    results.push(result);
    yield { type: "done" as const, text: "Done" };
  });
  const executor = createRunExecutor({
    prisma,
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    connector: {
      discoverTools: async () => [tool],
      resolveCall: async () => undefined,
      execute: vi.fn(async function* (call: ConnectorCall) {
        executed.push(call);
        yield { type: "result" as const, data: { id: call.args.id } };
      }),
    },
    sandbox: { describe: () => ({ capabilities: { graphical: false } }) },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
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
    codingGate: options.codingGate,
    shutdownSignal: undefined,
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  return {
    executed,
    results,
    async run() {
      await executor.continueRun(run.id, "worker-1");
    },
  };
}

describe("coding acceptance gate at the executor tool authorization point (T4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a gated tool call before execution and reports the refusal explicitly", async () => {
    const gate: CodingAcceptanceGate = {
      check: async () => ({
        allowed: false,
        reason:
          "No recorded acceptance artifact. Record the agreed outcome and verification commands before the first edit.",
      }),
    };
    const f = fixture({ codingGate: gate });
    await f.run();
    expect(f.executed).toHaveLength(0);
    expect(f.results[0]).toMatchObject({
      error: expect.stringMatching(/acceptance/i),
    });
  });

  it("lets the call through when the gate allows (acceptance recorded)", async () => {
    const gate: CodingAcceptanceGate = { check: async () => ({ allowed: true }) };
    const f = fixture({ codingGate: gate });
    await f.run();
    expect(f.executed).toHaveLength(1);
    expect(f.results[0]).not.toHaveProperty("error");
  });

  it("leaves non-coding runs untouched when no coding gate is installed (legacy behavior)", async () => {
    const f = fixture({ trigger: "user" });
    await f.run();
    expect(f.executed).toHaveLength(1);
    expect(f.results[0]).not.toHaveProperty("error");
  });

  it("FAILS CLOSED: a coding_session run with no gate installed refuses mutation tools (HIGH-1)", async () => {
    const f = fixture({ trigger: CODING_SESSION_TRIGGER });
    await f.run();
    expect(f.executed).toHaveLength(0);
    expect(f.results[0]).toMatchObject({
      error: expect.stringMatching(/refused/i),
    });
    expect(f.results[0]).toMatchObject({
      error: expect.stringMatching(/acceptance/i),
    });
  });

  it("fail-closed exemption is exactly the shared read-only allowlist, nothing broader", () => {
    // Same set the gate service enforces (proven member-by-member in
    // coding-acceptance-gate.test.ts), so the no-gate branch cannot drift.
    expect(CODING_READ_ONLY_TOOLS.has("read_file")).toBe(true);
    expect(CODING_READ_ONLY_TOOLS.has("computer_observe")).toBe(true);
    expect(CODING_READ_ONLY_TOOLS.has("demo_write_item")).toBe(false);
    expect(CODING_READ_ONLY_TOOLS.has("js")).toBe(false);
    expect(CODING_READ_ONLY_TOOLS.has("computer_act")).toBe(false);
  });
});
