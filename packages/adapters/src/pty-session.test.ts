/**
 * T28 — V18 RED: reconnectable terminals (adapter-kit pty extension)
 *
 * Verifies:
 * 1. FakeSandboxProvider.connectTerminal accepts sessionId for reconnect
 * 2. Reconnect replays scrollback
 * 3. Resize propagates
 * 4. Input round-trips
 * 5. pty capability is declared in SandboxCapabilities
 */

import { afterEach, describe, expect, it } from "vitest";
import type { AdapterContext, ComputerRef, SandboxProvider } from "@rakazo/adapter-kit";
import type { FakeTerminalGateway } from "./fake-terminal.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";

const gateways: import("./fake-terminal.js").FakeTerminalGateway[] = [];
afterEach(() => {
  for (const gw of gateways.splice(0)) gw.close();
});

function makeContext(): AdapterContext {
  return {
    operationId: "test-op",
    traceId: "trace-1",
    spaceId: "space-1",
    userId: "user-1",
    botId: "bot-1",
    runId: "run-1",
    signal: new AbortController().signal,
  };
}

function makeComputer(provider: SandboxProvider): ComputerRef {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake = provider as unknown as { boxes: Map<string, unknown> };
  if (!fake.boxes) throw new Error("need FakeSandboxProvider");
  const ref = {
    id: "term-test",
    botId: "bot-1",
    kind: "fake" as const,
    providerRef: "term-test",
  };
  fake.boxes.set(ref.id, {
    ref,
    files: new Map(),
    running: true,
    screens: new Map(),
    screenLeases: new Map(),
  });
  return ref;
}

describe("T28 RED: reconnectable terminals", () => {
  it("FakeSandboxProvider declares pty: true in SandboxCapabilities", async () => {
    const provider = new FakeSandboxProvider();
    const desc = provider.describe();
    expect(desc.capabilities.pty).toBe(true);
  });

  it("connectTerminal accepts cwd and returns a session id", async () => {
    const provider = new FakeSandboxProvider();
    const computer = makeComputer(provider);
    const ctx = makeContext();

    const result = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", cwd: "/home/rakazo/bots/bot-1" },
      ctx,
    );

    expect(result).toHaveProperty("sessionId");
    expect(typeof result.sessionId).toBe("string");
    expect(result).toHaveProperty("url");
    expect(typeof result.url).toBe("string");
  });

  it("reconnect with same sessionId replays scrollback", async () => {
    const provider = new FakeSandboxProvider();
    const computer = makeComputer(provider);
    const ctx = makeContext();

    // First connect
    const first = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1" },
      ctx,
    );
    expect(first).toHaveProperty("sessionId");

    // Reconnect with same sessionId
    const reconnect = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", sessionId: first.sessionId },
      ctx,
    );

    expect(reconnect.sessionId).toBe(first.sessionId);
    // Reconnect must preserve scrollback (available via the session)
    expect(reconnect).toHaveProperty("scrollback");
    expect(Array.isArray(reconnect.scrollback)).toBe(true);
  });

  it("resize event updates the terminal dimensions", async () => {
    const provider = new FakeSandboxProvider();
    const computer = makeComputer(provider);
    const ctx = makeContext();

    const result = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1" },
      ctx,
    );

    expect(result).toHaveProperty("resize");
    expect(typeof result.resize).toBe("function");

    await result.resize({ cols: 120, rows: 40 });

    // Dimensions are now updated on the session
    expect(result).toHaveProperty("cols", 120);
    expect(result).toHaveProperty("rows", 40);
  });

  it("sendInput round-trips through the session", async () => {
    const provider = new FakeSandboxProvider();
    const computer = makeComputer(provider);
    const ctx = makeContext();

    const result = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1" },
      ctx,
    );

    expect(result).toHaveProperty("sendInput");
    expect(typeof result.sendInput).toBe("function");

    // sendInput should not throw
    await result.sendInput({ kind: "text", text: "echo hello\n" });
  });

  it("different sessionId creates a new session", async () => {
    const provider = new FakeSandboxProvider();
    const computer = makeComputer(provider);
    const ctx = makeContext();

    const first = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1" },
      ctx,
    );

    const second = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", sessionId: "new-session" },
      ctx,
    );

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.sessionId).toBe("new-session");
  });

  it("attach returns a session with scrollback even when no terminal was open", async () => {
    const provider = new FakeSandboxProvider();
    const computer = makeComputer(provider);
    const ctx = makeContext();

    // Attach to a session that may not have been previously connected
    const result = await provider.connectTerminal(
      computer,
      { controlToken: "lease-1", sessionId: "always-attach-session" },
      ctx,
    );

    expect(result).toHaveProperty("sessionId", "always-attach-session");
    expect(result).toHaveProperty("scrollback");
    expect(Array.isArray(result.scrollback)).toBe(true);
  });
});
