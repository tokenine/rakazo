import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRunRequest, ConnectorTool } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODING_SESSION_TRIGGER } from "./coding-pi-adapter.js";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";

/**
 * 004-code-mode S3 (T17, V8) — executor-level proof that coding-session
 * shell command results are redacted by the TRANSFORM-AWARE egress filter
 * (literal + base64/hex/URL), replacing the literal-only redaction for
 * coding sessions. Non-coding runs keep the legacy literal-only behavior
 * (scoped replacement, per the task).
 *
 * The planted value is unique per run; the variants are computed
 * independently here so the assertions cannot pass vacuously: if the
 * redaction regresses to literal-only, the encoded forms LEAK and these
 * tests fail.
 */

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

const PLANTED = "ghp_t17plantedsecret42";

function variantsOf(value: string): string[] {
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return [
    value,
    b64,
    b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    Buffer.from(value, "utf8").toString("hex"),
    encodeURIComponent(value),
  ];
}

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function fixture(options: {
  trigger: string;
  mkdtempDir: string;
  /** Final done-text the runtime yields AFTER the shell call (transcript surface). */
  finalText?: string;
}) {
  dirs.push(options.mkdtempDir);
  const tool: ConnectorTool = {
    name: "shell",
    description: "shell",
    inputSchema: { type: "object", properties: {} },
    route: { connectorId: "demo", resourceId: "r", toolName: "shell" },
  };
  const results: unknown[] = [];
  const events = {
    append: vi.fn(async () => undefined),
    pauseRunForInput: vi.fn(async () => {
      run.status = "waiting_input";
      return true;
    }),
    finalizeRun: vi.fn(async () => ({ continuationRunId: null })),
  };
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger: options.trigger,
    leaseFence: 0,
    checkpoint: null,
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
    computer: { updateMany: vi.fn(async () => ({ count: 1 })) },
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
  const shellOutput = [
    `literal:${PLANTED}`,
    `b64:${Buffer.from(PLANTED).toString("base64")}`,
    `hex:${Buffer.from(PLANTED).toString("hex")}`,
  ].join(" ");
  const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
    const result = await request.executeTool!("shell", { command: "printenv" }, "call-1");
    results.push(result);
    yield { type: "done" as const, text: options.finalText ?? "Done" };
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
        yield { type: "stdout" as const, data: shellOutput };
        yield { type: "exit" as const, code: 0 };
      },
      exportWorkspace: async function* () {},
      readFile: async () => new TextEncoder().encode("x"),
    },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    home: { commit: async () => "rev-mock-fixture" },
    events,
    jobs: { enqueue: vi.fn(async () => undefined) },
    secrets: [],
    shutdownSignal: undefined,
    // T4 gate family: coding runs carry an acceptance gate; recorded here.
    codingGate:
      options.trigger === CODING_SESSION_TRIGGER
        ? { check: async () => ({ allowed: true }) }
        : undefined,
    // S3 T17: the coding-secrets egress values for this run.
    codingSecrets:
      options.trigger === CODING_SESSION_TRIGGER
        ? { egressValuesForRun: (runId: string) => (runId === "run-1" ? [PLANTED] : []) }
        : undefined,
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  return {
    results,
    events,
    async run() {
      await executor.continueRun(run.id, "worker-1");
    },
  };
}

describe("coding-session shell results are transform-aware redacted (T17, V8)", () => {
  it("a coding-session command result carries NO literal or encoded form of a granted secret", async () => {
    const f = await fixture({ trigger: CODING_SESSION_TRIGGER, mkdtempDir: await mkdtemp0() });
    await f.run();
    expect(f.results).toHaveLength(1);
    const result = f.results[0] as { stdout?: string; error?: string };
    const stdout = result.stdout ?? result.error ?? "";
    for (const variant of variantsOf(PLANTED)) {
      expect(stdout).not.toContain(variant);
    }
  });

  it("non-coding runs keep the legacy literal-only behavior (scoped replacement)", async () => {
    const f = await fixture({ trigger: "user", mkdtempDir: await mkdtemp0() });
    await f.run();
    const result = f.results[0] as { stdout?: string; error?: string };
    const stdout = result.stdout ?? result.error ?? "";
    // Scoped replacement: without coding-secrets values the encoded forms are
    // not covered (documented baseline; the LITERAL form is also uncensored
    // here because the value was never a run secret for a non-coding run).
    expect(stdout).toContain(`b64:${Buffer.from(PLANTED).toString("base64")}`);
  });

  it("fix r2 MED-1: a granted value echoed into the transcript AFTER a coding shell call is redacted (runSecrets egress push)", async () => {
    // The shell call happens first; the coding branch must push the granted
    // values into runSecrets so the EXISTING literal redactors (transcript
    // blocks, notification body, progress, review payloads, memory) cover
    // them. Before the fix the value leaks onto the transcript verbatim.
    const f = await fixture({
      trigger: CODING_SESSION_TRIGGER,
      mkdtempDir: await mkdtemp0(),
      finalText: `transcript-echo:${PLANTED}`,
    });
    await f.run();
    const surfaces = [
      ...f.events.append.mock.calls.map((call) => JSON.stringify(call)),
      ...f.events.finalizeRun.mock.calls.map((call) => JSON.stringify(call)),
    ].join("\n");
    expect(surfaces).not.toContain(PLANTED);
  });
});

function mkdtemp0(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "rakazo-s3-executor-"));
}
