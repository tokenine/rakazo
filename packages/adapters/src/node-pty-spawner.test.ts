/**
 * 004-code-mode S6 T28 — the production node-pty spawner and its injection
 * into createSandboxProvider("process").
 *
 * node-pty is a native module loaded lazily inside the spawner (dynamic
 * import), so these are the only tests that exercise the real binary. They
 * spawn a local bash inside a throwaway task workspace — deterministic and
 * offline, matching the repo's real-spawn conventions for the process
 * provider. Skipped on Windows, where the process provider is not POSIX.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PtySession } from "@rakazo/adapter-kit";
import { afterAll, describe, expect, it } from "vitest";
import { taskWorkspaceDirName, ProcessSandboxProvider } from "./process-sandbox.js";
import { createNodePtySpawner } from "./node-pty-spawner.js";
import { createSandboxProvider } from "./sandbox-factory.js";

const itPty = process.platform === "win32" ? it.skip : it;

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rakazo-s6-pty-"));
  roots.push(root);
  return root;
}

const ctx = {
  operationId: "test-op",
  traceId: "trace-1",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  signal: new AbortController().signal,
};

/** Poll reconnects until the scrollback contains `want`, else fail with what arrived. */
async function waitForScrollback(
  reconnect: () => Promise<PtySession>,
  want: string,
  deadlineMs = 15_000,
): Promise<string[]> {
  const deadline = Date.now() + deadlineMs;
  let lines: string[] = [];
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    lines = (await reconnect()).scrollback;
    if (lines.some((line) => line.includes(want))) return lines;
  }
  throw new Error(`scrollback never contained ${JSON.stringify(want)}; got ${JSON.stringify(lines)}`);
}

describe("T28 S6: node-pty production spawner", () => {
  itPty("spawns a real PTY whose output lines reach the injected listener", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, taskWorkspaceDirName("task-pty")), { recursive: true });
    const spawner = createNodePtySpawner({ root });

    const handle = await spawner("task-pty", 80, 24);
    const lines: string[] = [];
    handle.onData?.((line) => lines.push(line));

    handle.write?.("echo s6-marker-$((41+1))\n");
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !lines.some((line) => line.includes("s6-marker-42"))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(lines.some((line) => line.includes("s6-marker-42"))).toBe(true);

    handle.dispose();
  });

  itPty("resize reaches the live PTY (stty reports the new dimensions)", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, taskWorkspaceDirName("task-pty-dim")), { recursive: true });
    const spawner = createNodePtySpawner({ root });

    const handle = await spawner("task-pty-dim", 80, 24);
    const lines: string[] = [];
    handle.onData?.((line) => lines.push(line));

    handle.resize?.({ cols: 100, rows: 30 });
    handle.write?.("stty size\n");
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !lines.some((line) => line.trim() === "30 100")) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(lines.some((line) => line.trim() === "30 100")).toBe(true);

    handle.dispose();
  });

  itPty("T41: spawn args replace the default argv (launch command runs at spawn)", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, taskWorkspaceDirName("task-pty-launch")), { recursive: true });
    const spawner = createNodePtySpawner({ root });

    const handle = await spawner("task-pty-launch", 80, 24, {
      args: ["--norc", "-lc", "echo t41-launch-marker"],
    });
    const lines: string[] = [];
    handle.onData?.((line) => lines.push(line));

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !lines.some((line) => line.includes("t41-launch-marker"))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(lines.some((line) => line.includes("t41-launch-marker"))).toBe(true);

    handle.dispose();
  });

  itPty("dispose is quiet when called twice", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, taskWorkspaceDirName("task-pty-dispose")), { recursive: true });
    const spawner = createNodePtySpawner({ root });

    const handle = await spawner("task-pty-dispose", 80, 24);
    expect(() => handle.dispose()).not.toThrow();
    expect(() => handle.dispose()).not.toThrow();
  });

  itPty("createSandboxProvider('process') injects the real spawner end-to-end", async () => {
    const root = await makeRoot();
    const provider = createSandboxProvider("process", { dataDir: root });
    expect(provider.describe().capabilities.pty).toBe(true);
    expect(provider).toBeInstanceOf(ProcessSandboxProvider);
    const processProvider = provider as ProcessSandboxProvider;

    const task = await processProvider.createTaskContext({ taskId: "task-factory" });
    const session = await processProvider.connectTerminal(task.ref, { controlToken: "lease-1" }, ctx);
    await session.sendInput({ kind: "text", text: "echo factory-s6-$((20+22))\n" });

    const lines = await waitForScrollback(
      () =>
        processProvider.connectTerminal(task.ref, {
          controlToken: "lease-1",
          sessionId: session.sessionId,
        }, ctx),
      "factory-s6-42",
    );
    expect(lines.some((line) => line.includes("factory-s6-42"))).toBe(true);

    await processProvider.destroy(task.ref, ctx);
  });
});
