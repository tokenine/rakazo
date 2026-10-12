import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterContext, ProcessEvent } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { namespacedServiceName, ProcessSandboxProvider } from "./process-sandbox.js";

/**
 * 004-code-mode T10 — collision fixture matrix (V3): two tasks, one bot, ZERO
 * collisions across the enumerated classes: listening ports (dynamic bind +
 * retry), process names (per-task process-group naming), service/db names
 * (namespaced), workspace/data dirs (id-prefixed). Runs directly on the team
 * box under the process-level driver; no host action, no docker.
 */

const ctx: AdapterContext = {
  operationId: "matrix",
  traceId: "matrix",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
};

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function matrixFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "rakazo-collision-matrix-"));
  dirs.push(root);
  const provider = new ProcessSandboxProvider({ root });
  const a = await provider.createTaskContext({ taskId: "task-a" });
  const b = await provider.createTaskContext({ taskId: "task-b" });
  return { root, provider, a, b };
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

async function httpGet(port: number, pathName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = createConnection({ port, host: "127.0.0.1" }, () => {
      request.write(`GET ${pathName} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n`);
    });
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

describe("collision fixture matrix — two tasks, one bot, zero collisions (V3)", () => {
  it("class: workspace/data dirs are id-prefixed and disjoint", async () => {
    const { a, b } = await matrixFixture();
    expect(a.workspaceDir).toMatch(/cm-task-a-workspace$/);
    expect(a.dataDir).toMatch(/cm-task-a-data$/);
    expect(b.workspaceDir).toMatch(/cm-task-b-workspace$/);
    expect(b.dataDir).toMatch(/cm-task-b-data$/);
    expect(a.workspaceDir).not.toBe(b.workspaceDir);
    expect(a.dataDir).not.toBe(b.dataDir);
    expect(a.workspaceDir.startsWith(b.dataDir)).toBe(false);
    expect(b.workspaceDir.startsWith(a.dataDir)).toBe(false);
  });

  it("class: per-task process-group naming is applied at spawn", async () => {
    const { provider, a, b } = await matrixFixture();
    const probe = 'printf "%s %s" "$CODE_MODE_TASK_GROUP" "$CODE_MODE_TASK_ID"';
    const outA = await collect(provider.execute(a.ref, { argv: ["bash", "-c", probe] }, ctx));
    const outB = await collect(provider.execute(b.ref, { argv: ["bash", "-c", probe] }, ctx));
    expect(outA.stdout.trim()).toBe("cm-task-a task-a");
    expect(outB.stdout.trim()).toBe("cm-task-b task-b");
    expect(a.processGroupName).not.toBe(b.processGroupName);
  });

  it("class: service/db names are namespaced per task", () => {
    const a = namespacedServiceName("task-a", "postgres");
    const b = namespacedServiceName("task-b", "postgres");
    expect(a).toMatch(/^cm_task_a_/);
    expect(b).toMatch(/^cm_task_b_/);
    expect(namespacedServiceName("task-a", "postgres")).not.toBe(
      namespacedServiceName("task-a", "redis"),
    );
  });

  it("class: listening ports — dynamic bind + retry, distinct simultaneous allocations", async () => {
    const { provider } = await matrixFixture();
    const attempts: number[] = [];
    const first = await provider.allocatePort({ onAttempt: (n) => attempts.push(n) });
    const second = await provider.allocatePort({ onAttempt: (n) => attempts.push(n) });
    expect(first.port).not.toBe(second.port);
    // Bounded retry: each allocation reported its attempt count (1 here).
    expect(attempts).toEqual([1, 1]);
    await first.close();
    await second.close();
  });

  it("zero collisions end-to-end: two real task servers serve concurrently on distinct ports", async () => {
    const { provider, a, b } = await matrixFixture();
    const portA = await provider.allocatePort();
    const portB = await provider.allocatePort();
    expect(portA.port).not.toBe(portB.port);

    const serverScript = [
      "const http = require('node:http');",
      "const name = process.env.TASK_DECLARED;",
      "http.createServer((req, res) => res.end('served-by-' + name)).listen(process.env.PORT, '127.0.0.1');",
      "setTimeout(() => process.exit(0), 15000);",
    ].join("");
    const run = (taskCtx: typeof a, port: number) =>
      collect(
        provider.execute(
          taskCtx.ref,
          {
            argv: [process.execPath, "-e", serverScript],
            env: { PORT: String(port), TASK_DECLARED: taskCtx.taskId },
          },
          ctx,
        ),
      );
    const runningA = run(a, portA.port);
    const runningB = run(b, portB.port);

    // Both servers answer at the same time on their own ports: no cross-task
    // collision, no fixed-range contention.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const [responseA, responseB] = await Promise.all([
      httpGet(portA.port, "/"),
      httpGet(portB.port, "/"),
    ]);
    expect(responseA).toContain("served-by-task-a");
    expect(responseB).toContain("served-by-task-b");
    expect(responseA).not.toContain("task-b");
    expect(responseB).not.toContain("task-a");

    await provider.suspend(a.ref);
    await provider.suspend(b.ref);
    await runningA;
    await runningB;
    await portA.close();
    await portB.close();
  });
});
