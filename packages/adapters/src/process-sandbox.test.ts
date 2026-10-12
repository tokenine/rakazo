import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterContext, ProcessEvent } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PROCESS_TASK_LIMITS, ProcessSandboxProvider } from "./process-sandbox.js";
import { createSandboxProvider } from "./sandbox-factory.js";

const ctx: AdapterContext = {
  operationId: "test",
  traceId: "test",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
};

const dirs: string[] = [];
const envRestorations: Array<[string, string | undefined]> = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  for (const [key, value] of envRestorations.splice(0)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function fixtureProvider() {
  const root = await mkdtemp(path.join(tmpdir(), "rakazo-process-sandbox-"));
  dirs.push(root);
  return { root, provider: new ProcessSandboxProvider({ root }) };
}

async function collect(generator: AsyncIterable<ProcessEvent>) {
  let stdout = "";
  let stderr = "";
  let code = -1;
  for await (const event of generator) {
    if (event.type === "stdout") stdout += event.data;
    if (event.type === "stderr") stderr += event.data;
    if (event.type === "exit") code = event.code;
  }
  return { stdout, stderr, code };
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met before timeout");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("per-task process runtime — task contexts from the setup definition (T9)", () => {
  it("creates id-prefixed, dedicated workspace and data trees per task", async () => {
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({ taskId: "task-a" });
    expect(path.basename(task.workspaceDir)).toBe("cm-task-a-workspace");
    expect(path.basename(task.dataDir)).toBe("cm-task-a-data");
    await expect(stat(task.workspaceDir)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(stat(task.dataDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("two tasks on one bot get disjoint trees and process-group names", async () => {
    const { provider } = await fixtureProvider();
    const a = await provider.createTaskContext({ taskId: "task-a" });
    const b = await provider.createTaskContext({ taskId: "task-b" });
    expect(a.workspaceDir).not.toBe(b.workspaceDir);
    expect(a.dataDir).not.toBe(b.dataDir);
    expect(a.processGroupName).not.toBe(b.processGroupName);
    expect(a.processGroupName).toBe("cm-task-a");
    expect(b.processGroupName).toBe("cm-task-b");
  });

  it("spawns inside the task workspace and reports its ref as kind process", async () => {
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({ taskId: "task-c" });
    const result = await collect(provider.execute(task.ref, { argv: ["pwd"] }, ctx));
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(task.workspaceDir);
    expect(task.ref.kind).toBe("process");
    expect(task.ref.providerRef).toBe(task.workspaceDir);
  });

  it("the child observes the resource limits the driver applied at spawn (D-Q9)", async () => {
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({ taskId: "task-limits" });
    const result = await collect(
      provider.execute(
        task.ref,
        { argv: ["bash", "-c", "ulimit -t; ulimit -v; ulimit -u; ulimit -f"] },
        ctx,
      ),
    );
    expect(result.code).toBe(0);
    const values = result.stdout
      .trim()
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10));
    expect(values).toEqual([
      DEFAULT_PROCESS_TASK_LIMITS.cpuSeconds,
      DEFAULT_PROCESS_TASK_LIMITS.addressSpaceKb,
      DEFAULT_PROCESS_TASK_LIMITS.maxProcesses,
      DEFAULT_PROCESS_TASK_LIMITS.fileSizeBlocks,
    ]);
  });

  it("runs the command under the configured nice value (spawn-time, not advisory)", async () => {
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({ taskId: "task-nice", limits: { nice: 9 } });
    const result = await collect(
      provider.execute(task.ref, { argv: ["bash", "-c", "ps -o nice= -p $$"] }, ctx),
    );
    expect(result.code).toBe(0);
    expect(Number.parseInt(result.stdout.trim(), 10)).toBeGreaterThanOrEqual(9);
  });

  it("scrubs the environment at spawn: only the allowlist and declared task vars pass", async () => {
    envRestorations.push(["PROCESS_SANDBOX_POISON", process.env.PROCESS_SANDBOX_POISON]);
    process.env.PROCESS_SANDBOX_POISON = "parent-secret";
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({
      taskId: "task-env",
      env: { TASK_DECLARED: "declared-ok" },
    });
    const result = await collect(
      provider.execute(
        task.ref,
        {
          argv: [
            "bash",
            "-c",
            'printf "declared=%s poison=%s" "$TASK_DECLARED" "$PROCESS_SANDBOX_POISON"',
          ],
        },
        ctx,
      ),
    );
    expect(result.stdout).toBe("declared=declared-ok poison=");
  });

  it("refuses a cwd outside the task workspace (per-task tree containment)", async () => {
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({ taskId: "task-cwd" });
    const result = await collect(provider.execute(task.ref, { argv: ["pwd"], cwd: "/tmp" }, ctx));
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/outside this task's workspace/i);
  });

  it("idle-suspend stops the task process but retains the workspace; resume recreates", async () => {
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({ taskId: "task-suspend" });
    await provider.writeFile(
      task.ref,
      { path: "notes/keep.txt", content: new TextEncoder().encode("retained") },
      ctx,
    );
    const running = collect(provider.execute(task.ref, { argv: ["sleep", "30"] }, ctx));
    await waitFor(() => provider.liveTaskCount(task.ref) === 1);
    await provider.suspend(task.ref);
    const stopped = await running;
    expect(stopped.code).not.toBe(0);
    expect(provider.liveTaskCount(task.ref)).toBe(0);
    // Workspace + data trees are retained across the suspend.
    await expect(
      readFile(path.join(task.workspaceDir, "notes/keep.txt")).then((bytes) =>
        new TextDecoder().decode(bytes),
      ),
    ).resolves.toBe("retained");

    // Resume recreates the runtime and reattaches the SAME trees.
    const resumed = await provider.provision(
      { botId: "bot-1", homePath: task.workspaceDir, providerRef: task.taskId },
      ctx,
    );
    expect(resumed.fresh).toBe(true);
    const reattached = provider.taskContext(resumed);
    expect(reattached?.workspaceDir).toBe(task.workspaceDir);
    await expect(
      readFile(path.join(task.workspaceDir, "notes/keep.txt")).then((bytes) =>
        new TextDecoder().decode(bytes),
      ),
    ).resolves.toBe("retained");
  });

  it("an aborted in-flight command settles with a bounded wait and a recorded exit (T12 wiring)", async () => {
    const controller = new AbortController();
    const abortCtx: AdapterContext = { ...ctx, signal: controller.signal };
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({ taskId: "task-settle" });
    const running = collect(provider.execute(task.ref, { argv: ["sleep", "30"] }, abortCtx));
    await waitFor(() => provider.liveTaskCount(task.ref) === 1);
    controller.abort();
    const stopped = await running;
    // The recorded exit reflects the real settle: the child was killed and
    // actually closed before the exit was reported.
    expect(stopped.code).toBe(130);
    expect(stopped.stderr).toMatch(/command aborted/);
    // Group emptiness is asynchronous (the kernel needs a scheduling point to
    // reap the SIGKILLed members) — wait for the remembered pgid to prune.
    await waitFor(() => provider.liveTaskCount(task.ref) === 0);
  });

  it("suspend reaps a daemon backgrounded by a wrapper that already exited (pgid outlives wrapper)", async () => {
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({ taskId: "task-orphan-daemon" });
    const result = await collect(
      provider.execute(
        task.ref,
        { argv: ["bash", "-c", "sleep 300 >/dev/null 2>&1 & echo $! > daemon.pid"] },
        ctx,
      ),
    );
    expect(result.code).toBe(0);
    const daemonPid = Number.parseInt(
      readFileSync(path.join(task.workspaceDir, "daemon.pid"), "utf8").trim(),
      10,
    );
    expect(Number.isFinite(daemonPid)).toBe(true);
    // The daemon (same task process group) outlived its already-exited wrapper.
    await waitFor(() => {
      try {
        process.kill(daemonPid, 0);
        return true;
      } catch {
        return false;
      }
    });
    // The task still has live work even though execute() forgot the wrapper:
    // the remembered pgid must keep counting (liveTaskCount reflects it).
    expect(provider.liveTaskCount(task.ref)).toBe(1);
    // Suspend must kill the WHOLE task group — daemon included — and verify
    // the group emptied.
    await provider.suspend(task.ref);
    await waitFor(() => {
      try {
        process.kill(daemonPid, 0);
        return false;
      } catch {
        return true;
      }
    });
    expect(provider.liveTaskCount(task.ref)).toBe(0);
  });

  it("destroy() drops the runtime record, never the workspace", async () => {
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({ taskId: "task-destroy" });
    await provider.writeFile(
      task.ref,
      { path: "keep.txt", content: new TextEncoder().encode("still here") },
      ctx,
    );
    await provider.destroy(task.ref, ctx);
    await expect(
      readFile(path.join(task.workspaceDir, "keep.txt")).then((bytes) =>
        new TextDecoder().decode(bytes),
      ),
    ).resolves.toBe("still here");
  });

  it("exposes the recorded limits manifest per task (what the doctor verifies)", async () => {
    const { provider } = await fixtureProvider();
    const task = await provider.createTaskContext({
      taskId: "task-manifest",
      limits: { cpuSeconds: 42 },
    });
    expect(task.limits.cpuSeconds).toBe(42);
    expect(task.limits.addressSpaceKb).toBe(DEFAULT_PROCESS_TASK_LIMITS.addressSpaceKb);
    expect(task.limits.nice).toBe(DEFAULT_PROCESS_TASK_LIMITS.nice);
  });
});

describe("process provider behind the existing sandbox seam", () => {
  it("is reachable through createSandboxProvider('process')", async () => {
    const provider = createSandboxProvider("process", {});
    expect(provider.describe().id).toBe("process");
    expect(provider.describe().capabilities.persistentHome).toBe(true);
  });

  it("runs a write/read/list/export/import round-trip through the SandboxProvider API", async () => {
    const { provider } = await fixtureProvider();
    const ref = await provider.provision({ botId: "bot-roundtrip", homePath: "/unused" }, ctx);
    await provider.prepare(ref, ctx);
    await provider.writeFile(
      ref,
      { path: "notes/hello.txt", content: new TextEncoder().encode("hi") },
      ctx,
    );
    const bytes = await provider.readFile(ref, "notes/hello.txt", ctx);
    expect(new TextDecoder().decode(bytes)).toBe("hi");
    const entries = await provider.listFiles(ref, "notes", ctx);
    expect(entries).toEqual([{ path: "notes/hello.txt", kind: "file", size: 2 }]);
    const exported: string[] = [];
    for await (const file of provider.exportWorkspace(ref, ctx)) exported.push(file.path);
    expect(exported).toContain("notes/hello.txt");
    await provider.importWorkspace(
      ref,
      (async function* () {
        yield { path: "imported.txt", content: new TextEncoder().encode("x") };
      })(),
      ctx,
    );
    await expect(
      readFile(path.join(provider.taskContext(ref)!.workspaceDir, "imported.txt")).then((bytes) =>
        new TextDecoder().decode(bytes),
      ),
    ).resolves.toBe("x");
  });
});
