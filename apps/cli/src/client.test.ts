/**
 * T31 V20 — RED: CLI client attaches to a server-owned session, shows pending
 * approvals, approve/deny a pending request, and sends a steer/prompt.
 *
 * Integration through the API layer (apps/api/src/router.ts) — same seam the web uses.
 *
 * Routes exercised:
 *   threads.listSessions  → session list for a bot
 *   threads.get           → thread snapshot (includes pending message blocks)
 *   mcp.assignments.approve → approve an MCP assignment
 *   mcp.assignments.dismiss → deny/dismiss an MCP assignment
 *   threads.send          → send a steer/prompt to a thread
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient, type Client } from "./client.js";

// ---------------------------------------------------------------------------
// Fake fetch
// ---------------------------------------------------------------------------

/** Fake responses keyed by ORPC method name (namespace.method). */
type FakeResponses = Record<string, unknown>;

/** Sentinel value that signals makeFakeFetch should throw an ORPCError. */
const ERROR_SENTINEL = Object.freeze({ orpcError: true });

/** Converts an Error into the ERROR_SENTINEL marker so it can travel through
 *  the Record (plain objects can't hold Error instances in the same way). */
function orpcErr(message: string): typeof ERROR_SENTINEL {
  // Keep a mutable object registry so we can reconstruct the error at throw time.
  return ERROR_SENTINEL;
}

/** Reconstructs an ORPCError from an error sentinel. */
function throwOrpcError(message: string): never {
  throw new Error(`ORPCError: ${message}`);
}

function makeFakeFetch(responses: FakeResponses) {
  return vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    const id =
      typeof body === "object" && body !== null && "id" in body
        ? ((body as { id?: number }).id ?? 0)
        : 0;
    const method =
      typeof body === "object" && body !== null && "method" in body
        ? ((body as { method?: string }).method ?? "")
        : "";

    const data = responses[method];

    // Handle error sentinel — throw before trying to build a JSON response.
    if (data === ERROR_SENTINEL) {
      throwOrpcError("NOT_FOUND");
    }

    if (data === undefined) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unhandled method: ${method}` },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Handle Error instances stored as response values.
    if (data instanceof Error) {
      throwOrpcError(data.message);
    }

    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("T31 RED: CLI client session attachment and approval operations", () => {
  const BASE_URL = "http://127.0.0.1:3000/rpc";
  const SPACE_ID = "space-1";
  const BOT_ID = "bot-1";
  const SESSION_ID = "session-1";
  const THREAD_ID = "thread-1";
  const SERVER_ID = "server-1";

  let responses: FakeResponses;
  let fakeFetch: ReturnType<typeof makeFakeFetch>;
  let client: Client;

  beforeEach(() => {
    responses = {} as FakeResponses;
    fakeFetch = makeFakeFetch(responses);
    client = createClient({ baseUrl: BASE_URL, spaceId: SPACE_ID, fetch: fakeFetch });
  });

  // -------------------------------------------------------------------------
  // attach — list sessions for a bot
  // -------------------------------------------------------------------------

  describe("attach", () => {
    it("returns session list for a bot", async () => {
      responses["threads.listSessions"] = [
        {
          id: SESSION_ID,
          botId: BOT_ID,
          name: "primary",
          createdAt: "2026-01-01T00:00:00Z",
          lastMessageAt: "2026-01-01T00:01:00Z",
        },
      ] as unknown;

      const sessions = await client.listSessions(BOT_ID);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ id: SESSION_ID, botId: BOT_ID, name: "primary" });

      // Verify request was POSTed to the RPC endpoint with correct params.
      const calls = fakeFetch.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1]!;
      const reqBody = JSON.parse(lastCall[1]!.body as string);
      expect(reqBody.method).toBe("threads.listSessions");
      expect(reqBody.params).toMatchObject({ botId: BOT_ID });
    });

    it("returns an empty list when no sessions exist for the bot", async () => {
      responses["threads.listSessions"] = [] as unknown;

      const sessions = await client.listSessions(BOT_ID);
      expect(sessions).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // attach — get thread snapshot (shows pending MCP approvals)
  // -------------------------------------------------------------------------

  describe("getThread (attach)", () => {
    it("returns thread snapshot with pending MCP approval blocks", async () => {
      responses["threads.get"] = {
        threadId: THREAD_ID,
        botId: BOT_ID,
        messages: [
          {
            id: "msg-1",
            role: "agent",
            blocks: [
              {
                kind: "mcp_approval",
                name: "Filesystem MCP",
                serverId: SERVER_ID,
                transport: "stdio",
                endpoint: null,
                needsOAuth: false,
                status: "pending",
              },
            ],
          },
        ],
      } as unknown;

      const thread = await client.getThread({ botId: BOT_ID });

      expect(thread.messages).toHaveLength(1);
      const approvalBlock = thread.messages[0]!.blocks.find((b) => b.kind === "mcp_approval");
      expect(approvalBlock).toBeDefined();
      expect(approvalBlock).toMatchObject({
        kind: "mcp_approval",
        status: "pending",
        serverId: SERVER_ID,
      });
    });

    it("returns empty messages when thread has no pending approvals", async () => {
      responses["threads.get"] = {
        threadId: THREAD_ID,
        botId: BOT_ID,
        messages: [],
      } as unknown;

      const thread = await client.getThread({ botId: BOT_ID });

      expect(thread.messages).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // approve — approve a pending MCP assignment
  // -------------------------------------------------------------------------

  describe("approveMcpAssignment", () => {
    it("approves a pending MCP server assignment", async () => {
      responses["mcp.assignments.approve"] = {
        id: SERVER_ID,
        botId: BOT_ID,
        serverId: SERVER_ID,
        status: "connected",
      } as unknown;

      const result = await client.approveMcpAssignment({
        botId: BOT_ID,
        serverId: SERVER_ID,
      });

      expect(result.status).toBe("connected");

      // Verify the correct RPC method and params were sent.
      const calls = fakeFetch.mock.calls;
      const reqBody = JSON.parse(calls[calls.length - 1]![1]!.body as string);
      expect(reqBody.method).toBe("mcp.assignments.approve");
      expect(reqBody.params).toMatchObject({ botId: BOT_ID, serverId: SERVER_ID });
    });

    it("throws when the assignment is not found", async () => {
      // Sentinel value: makeFakeFetch throws ORPCError with NOT_FOUND.
      responses["mcp.assignments.approve"] = ERROR_SENTINEL;

      await expect(
        client.approveMcpAssignment({ botId: BOT_ID, serverId: "unknown-server" }),
      ).rejects.toThrow("ORPCError: NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // deny — dismiss a pending MCP assignment
  // -------------------------------------------------------------------------

  describe("denyMcpAssignment", () => {
    it("denies (dismisses) a pending MCP server assignment", async () => {
      responses["mcp.assignments.dismiss"] = {
        id: SERVER_ID,
        botId: BOT_ID,
        serverId: SERVER_ID,
        status: "dismissed",
      } as unknown;

      const result = await client.denyMcpAssignment({
        botId: BOT_ID,
        serverId: SERVER_ID,
      });

      expect(result.status).toBe("dismissed");

      const calls = fakeFetch.mock.calls;
      const reqBody = JSON.parse(calls[calls.length - 1]![1]!.body as string);
      expect(reqBody.method).toBe("mcp.assignments.dismiss");
      expect(reqBody.params).toMatchObject({ botId: BOT_ID, serverId: SERVER_ID });
    });

    it("throws when the assignment is not found", async () => {
      responses["mcp.assignments.dismiss"] = ERROR_SENTINEL;

      await expect(
        client.denyMcpAssignment({ botId: BOT_ID, serverId: "unknown-server" }),
      ).rejects.toThrow("ORPCError: NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // steer — send a steer/prompt line to a session
  // -------------------------------------------------------------------------

  describe("steer", () => {
    it("sends a steer/prompt to a thread and returns the sent confirmation", async () => {
      responses["threads.send"] = {
        messageId: "msg-steer-1",
        role: "user",
        content: [{ kind: "text", text: "resume the build" }],
        createdAt: "2026-01-01T00:05:00Z",
      } as unknown;

      const result = await client.steer({
        botId: BOT_ID,
        message: "resume the build",
      });

      expect(result.role).toBe("user");
      expect(result.content).toContainEqual(
        expect.objectContaining({ kind: "text", text: "resume the build" }),
      );

      const calls = fakeFetch.mock.calls;
      const reqBody = JSON.parse(calls[calls.length - 1]![1]!.body as string);
      expect(reqBody.method).toBe("threads.send");
      expect(reqBody.params).toMatchObject({
        botId: BOT_ID,
        content: [{ kind: "text", text: "resume the build" }],
      });
    });

    it("throws when the thread cannot be resolved", async () => {
      responses["threads.send"] = ERROR_SENTINEL;

      await expect(
        client.steer({ botId: "nonexistent-bot", message: "hello" }),
      ).rejects.toThrow("ORPCError: NOT_FOUND");
    });
  });
});
