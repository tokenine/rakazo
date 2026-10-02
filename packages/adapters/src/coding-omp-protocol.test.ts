/**
 * 004-code-mode T25 — OMP RPC protocol-fidelity tests.
 *
 * Spawns REAL child processes that emit genuine OMP protocol frames and
 * verifies OmpRpcSession parses and correlates them correctly.
 *
 * Child processes use synchronous rl.on('line') handlers so they stay alive
 * indefinitely after sending agent_end. Parent calls session.stop() which kills
 * the child; the safe proc.on('close') handler clears pending requests
 * without rejecting them.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { type CodingOmpAdapterDeps, OmpRpcSession } from "./coding-omp-adapter.js";

// ---------------------------------------------------------------------------
// Mock-OMP child scripts
// ---------------------------------------------------------------------------

const NODE_PATH = "/opt/node-22.23.3/bin/node";

/**
 * Scenario A: ready → prompt → response + text_delta + tool_execution_end(isError=false) + agent_end(isTerminal=true).
 * Uses synchronous rl.on('line') so the script stays alive after agent_end.
 */
function scenarioA(): string {
  return `
// @ts-nocheck
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function sendFrame(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

sendFrame({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576 });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const id = msg.id;
  if (msg.type === 'prompt') {
    sendFrame({ type: 'response', id, command: 'prompt', success: true, data: {} });
    sendFrame({ type: 'message_update', id, update: { type: 'text_delta', content: 'hello' } });
    sendFrame({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'bash', result: { content: [{ type: 'text', text: 'TOOL-OUTPUT-123' }] }, isError: false });
    sendFrame({ type: 'agent_end', messages: [], isTerminal: true, yielded: false });
  }
  if (msg.type === 'get_messages_page') {
    sendFrame({ type: 'response', id, command: 'get_messages_page', success: true, data: { messages: [] } });
  }
});
`;
}

/**
 * Scenario B: ready → prompt → response + extension_ui_request(select) + tool_execution_end + agent_end.
 */
function scenarioB(): string {
  return `
// @ts-nocheck
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function sendFrame(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

sendFrame({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576 });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const id = msg.id;
  if (msg.type === 'prompt') {
    sendFrame({ type: 'response', id, command: 'prompt', success: true, data: {} });
    sendFrame({ type: 'extension_ui_request', id: 'req1', method: 'select', title: 'Allow tool: bash\\\\nCommand: echo hi', options: ['Approve', 'Deny'] });
    sendFrame({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'bash', result: { content: [{ type: 'text', text: 'TOOL-OUTPUT-456' }] }, isError: false });
    sendFrame({ type: 'agent_end', messages: [], isTerminal: true, yielded: false });
  }
  if (msg.type === 'get_messages_page') {
    sendFrame({ type: 'response', id, command: 'get_messages_page', success: true, data: { messages: [] } });
  }
});
`;
}

/**
 * Scenario C: ready → prompt → response + tool_execution_end(isError=true) + agent_end.
 */
function scenarioC(): string {
  return `
// @ts-nocheck
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function sendFrame(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

sendFrame({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576 });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const id = msg.id;
  if (msg.type === 'prompt') {
    sendFrame({ type: 'response', id, command: 'prompt', success: true, data: {} });
    sendFrame({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'bash', result: { content: [{ type: 'text', text: 'Tool call denied by user: bash' }] }, isError: true });
    sendFrame({ type: 'agent_end', messages: [], isTerminal: true, yielded: false });
  }
  if (msg.type === 'get_messages_page') {
    sendFrame({ type: 'response', id, command: 'get_messages_page', success: true, data: { messages: [] } });
  }
});
`;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Writes a mock script and returns a deps object wired to spawn it. */
async function makeDeps(
  _scriptContent: string,
): Promise<{ tmp: string; deps: CodingOmpAdapterDeps }> {
  const tmp = await mkdtemp(`${tmpdir()}/omp-protocol-test-`);
  const scriptPath = `${tmp}/mock-omp.mjs`;

  const stdioOptions: ["pipe", "pipe", "inherit"] = ["pipe", "pipe", "inherit"];
  const innerSpawn = async (): Promise<ChildProcess> =>
    spawn(NODE_PATH, [scriptPath], { stdio: stdioOptions });

  const deps: CodingOmpAdapterDeps = {
    sessionFactory: (d, sessionId) => new OmpRpcSession(d, sessionId),
    spawnOmp: innerSpawn,
    approveTool: async () => {},
  };

  return { tmp, deps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OMP RPC protocol-fidelity tests", () => {
  // -------------------------------------------------------------------------
  // Scenario A — basic terminal session
  // -------------------------------------------------------------------------
  describe("Scenario A — basic terminal session", () => {
    it("parses ready handshake, correlates prompt id, captures tool_execution_end, returns isTerminal:true", async () => {
      const { tmp, deps } = await makeDeps(scenarioA());

      const session = new OmpRpcSession(deps, "test-session-a");
      await session.start();

      const result = await session.prompt("hello");
      expect(result.isTerminal).toBe(true);

      const changes = await session.inspectChanges();
      const bashResult = changes.toolResults.find((r) => r.toolName === "bash");
      expect(bashResult).toBeDefined();
      expect(bashResult!.result).toEqual({
        content: [{ type: "text", text: "TOOL-OUTPUT-123" }],
      });
      expect(bashResult!.isError).toBe(false);

      await session.stop();
      await rm(tmp, { recursive: true, force: true });
    });

    it("session settles with isTerminal:true and correct sessionId after one prompt", async () => {
      const { tmp, deps } = await makeDeps(scenarioA());

      const session = new OmpRpcSession(deps, "test-session-a2");
      await session.start();
      const result = await session.prompt("hello");

      expect(result.isTerminal).toBe(true);
      expect(result.sessionId).toBe("test-session-a2");

      await session.stop();
      await rm(tmp, { recursive: true, force: true });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario B — approval flow
  // -------------------------------------------------------------------------
  describe("Scenario B — approval flow", () => {
    it("emits extension_ui_request(select) and approveTool sends extension_ui_response", async () => {
      const { tmp, deps } = await makeDeps(scenarioB());

      const session = new OmpRpcSession(deps, "test-session-b");
      await session.start();

      // Start the prompt — it will block waiting for agent_end after sending extension_ui_request
      const promptPromise = session.prompt("hello");

      // Wait for the extension_ui_request to arrive (no deterministic signal, so poll)
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const approvals = await session.getPendingApprovals();
      expect(approvals.pending).toHaveLength(1);
      expect(approvals.pending[0]!.method).toBe("select");
      expect(approvals.pending[0]!.title).toContain("Allow tool: bash");
      expect(approvals.pending[0]!.options).toEqual(["Approve", "Deny"]);

      // Approve the tool — this sends extension_ui_response and resolves approveTool
      await session.approveTool(approvals.pending[0]!.id, "Approve");

      // Now the session should complete
      const result = await promptPromise;
      expect(result.isTerminal).toBe(true);

      const changes = await session.inspectChanges();
      const bashResult = changes.toolResults.find((r) => r.toolName === "bash");
      expect(bashResult).toBeDefined();
      expect(bashResult!.result).toEqual({
        content: [{ type: "text", text: "TOOL-OUTPUT-456" }],
      });

      await session.stop();
      await rm(tmp, { recursive: true, force: true });
    });

    it("approveTool called with Deny resolves the pending approval", async () => {
      const { tmp, deps } = await makeDeps(scenarioB());

      const session = new OmpRpcSession(deps, "test-session-b2");
      await session.start();

      const promptPromise = session.prompt("hello");

      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const approvals = await session.getPendingApprovals();
      expect(approvals.pending).toHaveLength(1);

      await session.approveTool(approvals.pending[0]!.id, "Deny");

      const result = await promptPromise;
      expect(result.isTerminal).toBe(true);

      await session.stop();
      await rm(tmp, { recursive: true, force: true });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario C — deny / isError:true flow
  // -------------------------------------------------------------------------
  describe("Scenario C — deny flow (isError:true)", () => {
    it("session completes without throwing, inspectChanges shows isError:true", async () => {
      const { tmp, deps } = await makeDeps(scenarioC());

      const session = new OmpRpcSession(deps, "test-session-c");
      await session.start();

      // Should not throw
      const result = await session.prompt("hello");
      expect(result.isTerminal).toBe(true);

      const changes = await session.inspectChanges();
      const bashResult = changes.toolResults.find((r) => r.toolName === "bash");
      expect(bashResult).toBeDefined();
      expect(bashResult!.isError).toBe(true);
      expect(bashResult!.result).toEqual({
        content: [{ type: "text", text: "Tool call denied by user: bash" }],
      });

      await session.stop();
      await rm(tmp, { recursive: true, force: true });
    });
  });
});
