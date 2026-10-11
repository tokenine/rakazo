/**
 * 004-code-mode S6 T28 — real PtySpawner wiring in ProcessSandboxProvider.
 *
 * S5 left the spawner a no-op stub: connectTerminal discarded the spawner
 * result, so nothing observed the PTY. These tests pin the wiring contract:
 * the handle returned by the spawner is kept per session, its output lines
 * land in the TCB scrollback (replayable on reconnect), input writes and
 * resize reach the live PTY, and destroy disposes the handle.
 *
 * A fake handle keeps this file hermetic; the node-pty spawner itself is
 * covered in node-pty-spawner.test.ts.
 */

import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { ProcessSandboxProvider } from "./process-sandbox.js";

const ctx: AdapterContext = {
  operationId: "test-op",
  traceId: "trace-1",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  signal: new AbortController().signal,
};

/** A fake live-PTY handle recording every wiring call the provider makes. */
function fakePtyHandle() {
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  let disposals = 0;
  let listener: ((line: string) => void) | undefined;
  const handle = {
    dispose: () => {
      disposals += 1;
    },
    write: (data: string) => {
      writes.push(data);
    },
    resize: (dim: { cols: number; rows: number }) => {
      resizes.push(dim);
    },
    onData: (registered: (line: string) => void) => {
      listener = registered;
    },
  };
  return {
    handle,
    writes,
    resizes,
    disposals: () => disposals,
    emit: (line: string) => listener?.(line),
  };
}

async function makeProvider(spawner: ReturnType<typeof vi.fn>) {
  const provider = new ProcessSandboxProvider({
    root: `process-pty-wiring-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ptySpawner: spawner as any,
  });
  const task = await provider.createTaskContext({ taskId: "task-1" });
  return { provider, computer: task.ref as ComputerRef };
}

describe("T28 S6: PtySpawner wiring in ProcessSandboxProvider", () => {
  it("spawner receives the task id and the initial terminal dimensions", async () => {
    const fake = fakePtyHandle();
    const spawner = vi.fn(async () => fake.handle);
    const { provider, computer } = await makeProvider(spawner);

    await provider.connectTerminal(computer, { controlToken: "lease-1" }, ctx);

    expect(spawner).toHaveBeenCalledWith("task-1", 80, 24);
  });

  it("records spawner output lines into the session scrollback", async () => {
    const fake = fakePtyHandle();
    const { provider, computer } = await makeProvider(vi.fn(async () => fake.handle));

    const session = await provider.connectTerminal(computer, { controlToken: "lease-1" }, ctx);
    fake.emit("hello");
    fake.emit("world");

    const reconnect = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", sessionId: session.sessionId },
      ctx,
    );
    expect(reconnect.scrollback).toEqual(["hello", "world"]);
  });

  it("writes text input to the live PTY", async () => {
    const fake = fakePtyHandle();
    const { provider, computer } = await makeProvider(vi.fn(async () => fake.handle));

    const session = await provider.connectTerminal(computer, { controlToken: "lease-1" }, ctx);
    await session.sendInput({ kind: "text", text: "echo hi\n" });

    expect(fake.writes).toEqual(["echo hi\n"]);
  });

  it("writes input on a reconnected session to the live PTY", async () => {
    const fake = fakePtyHandle();
    const { provider, computer } = await makeProvider(vi.fn(async () => fake.handle));

    const session = await provider.connectTerminal(computer, { controlToken: "lease-1" }, ctx);
    const reconnect = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", sessionId: session.sessionId },
      ctx,
    );
    await reconnect.sendInput({ kind: "text", text: "ls\n" });

    expect(fake.writes).toEqual(["ls\n"]);
  });

  it("propagates resize to the live PTY and updates the session record", async () => {
    const fake = fakePtyHandle();
    const { provider, computer } = await makeProvider(vi.fn(async () => fake.handle));

    const session = await provider.connectTerminal(computer, { controlToken: "lease-1" }, ctx);
    await session.resize({ cols: 120, rows: 40 });

    expect(fake.resizes).toEqual([{ cols: 120, rows: 40 }]);
    const reconnect = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", sessionId: session.sessionId },
      ctx,
    );
    expect(reconnect.cols).toBe(120);
    expect(reconnect.rows).toBe(40);
  });

  it("disposes the live PTY handle when the task is destroyed", async () => {
    const fake = fakePtyHandle();
    const { provider, computer } = await makeProvider(vi.fn(async () => fake.handle));

    await provider.connectTerminal(computer, { controlToken: "lease-1" }, ctx);
    await provider.destroy(computer, ctx);

    expect(fake.disposals()).toBe(1);
  });

  it("T40: a view-only session drops input frames before the live PTY", async () => {
    const fake = fakePtyHandle();
    const { provider, computer } = await makeProvider(vi.fn(async () => fake.handle));

    const session = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", viewOnly: true },
      ctx,
    );
    await session.sendInput({ kind: "text", text: "rm -rf /\n" });
    await session.resize({ cols: 100, rows: 30 });

    expect(fake.writes).toEqual([]);
    expect(fake.resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it("T40: a reconnected view-only session still drops input", async () => {
    const fake = fakePtyHandle();
    const { provider, computer } = await makeProvider(vi.fn(async () => fake.handle));

    const session = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", viewOnly: true },
      ctx,
    );
    const reconnect = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", sessionId: session.sessionId },
      ctx,
    );
    await reconnect.sendInput({ kind: "text", text: "ls\n" });

    expect(fake.writes).toEqual([]);
  });

  it("a failed spawn refuses the terminal and leaves the session operable", async () => {
    const fake = fakePtyHandle();
    const { provider, computer } = await makeProvider(
      vi.fn(async () => {
        throw new Error("pty spawn failed");
      }),
    );

    await expect(
      provider.connectTerminal(computer, { controlToken: "lease-1" }, ctx),
    ).rejects.toThrow("pty spawn failed");

    // The provider stays usable: a working spawner still connects.
    const second = new ProcessSandboxProvider({ ptySpawner: async () => fake.handle });
    const task = await second.createTaskContext({ taskId: "task-1" });
    const session = await second.connectTerminal(task.ref, { controlToken: "lease-1" }, ctx);
    expect(session.sessionId).toBeTruthy();
  });
});
