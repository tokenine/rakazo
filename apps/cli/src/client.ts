/**
 * Thin HTTP client against the existing ORPC API — no new server endpoints needed.
 *
 * Operations:
 *   listSessions  — list sessions for a bot (threads.listSessions)
 *   getThread      — get thread snapshot with pending approval blocks (threads.get)
 *   listMcpAssignments — list MCP server assignments / approvals (mcp.assignments.list)
 *   approveMcpAssignment — approve a pending MCP server assignment (mcp.assignments.approve)
 *   denyMcpAssignment   — deny (dismiss) a pending MCP server assignment (mcp.assignments.dismiss)
 *   steer          — send a steer/prompt to a thread (threads.send)
 *
 * Auth: Bearer token via RAKAZO_TOKEN env var. Space context via x-rakazo-space-id header.
 */

import type { MessageBlock } from "@rakazo/contracts";
import { orpcInvoke } from "./rpc.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  botId: string;
  name: string;
  createdAt: string;
  lastMessageAt: string | null;
}

export interface ThreadSnapshot {
  threadId: string;
  botId: string;
  messages: ThreadMessage[];
}

export interface ThreadMessage {
  id: string;
  role: "user" | "bot" | "system";
  blocks: MessageBlock[];
}

export interface McpAssignment {
  id: string;
  botId: string;
  serverId: string;
  status: "pending" | "connected" | "dismissed";
  serverName?: string;
}

export interface SentMessage {
  taskId: string;
  runId: string;
  seq: number;
}

/** Exposed as the public contract — consumers import this name directly. */
export interface Client {
  listSessions(botId: string): Promise<Session[]>;
  getThread(input: { botId: string; threadId?: string }): Promise<ThreadSnapshot>;
  listMcpAssignments(botId: string): Promise<McpAssignment[]>;
  approveMcpAssignment(input: { botId: string; serverId: string }): Promise<McpAssignment>;
  denyMcpAssignment(input: { botId: string; serverId: string }): Promise<McpAssignment>;
  steer(input: { botId: string; message: string; threadId?: string }): Promise<SentMessage>;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface ClientOptions {
  baseUrl: string;
  spaceId: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// ORPC JSON-RPC 2.0 invoke
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createClient(opts: ClientOptions): Client {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const token = opts.token ?? process.env.RAKAZO_TOKEN ?? "";
  const fetchImpl = opts.fetch ?? globalThis.fetch;

  const headers: Record<string, string> = {
    "x-rakazo-space-id": opts.spaceId,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  return {
    async listSessions(botId) {
      const result = await orpcInvoke(
        baseUrl,
        "threads.listSessions",
        { botId },
        headers,
        fetchImpl,
      );
      return result as Session[];
    },

    async getThread(input) {
      const result = await orpcInvoke(
        baseUrl,
        "threads.get",
        input.threadId ? { botId: input.botId, threadId: input.threadId } : { botId: input.botId },
        headers,
        fetchImpl,
      );
      return result as ThreadSnapshot;
    },

    async listMcpAssignments(botId) {
      const result = await orpcInvoke(
        baseUrl,
        "mcp.assignments.list",
        { botId },
        headers,
        fetchImpl,
      );
      return result as McpAssignment[];
    },

    async approveMcpAssignment(input) {
      const result = await orpcInvoke(
        baseUrl,
        "mcp.assignments.approve",
        { botId: input.botId, serverId: input.serverId },
        headers,
        fetchImpl,
      );
      return result as McpAssignment;
    },

    async denyMcpAssignment(input) {
      const result = await orpcInvoke(
        baseUrl,
        "mcp.assignments.dismiss",
        { botId: input.botId, serverId: input.serverId },
        headers,
        fetchImpl,
      );
      return result as McpAssignment;
    },

    async steer(input) {
      const result = await orpcInvoke(
        baseUrl,
        "threads.send",
        {
          botId: input.botId,
          ...(input.threadId ? { threadId: input.threadId } : {}),
          text: input.message,
        },
        headers,
        fetchImpl,
      );
      return result as SentMessage;
    },
  };
}
