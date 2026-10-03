/**
 * attach — list sessions for a bot and show pending approvals in each session's thread.
 *
 * Usage:
 *   rakazo attach <bot-id> [--base-url http://127.0.0.1:3000/rpc]
 *
 * Output: session list + any pending MCP approvals found in each thread.
 */

import { createClient } from "../client.js";
import type { Client } from "../client.js";
import type { MessageBlock } from "@rakazo/contracts";

export interface AttachOptions {
  botId: string;
  baseUrl: string;
  spaceId: string;
  token?: string;
}

export async function attach(opts: AttachOptions): Promise<void> {
  const client: Client = createClient({
    baseUrl: opts.baseUrl,
    spaceId: opts.spaceId,
    token: opts.token,
  });

  // List sessions.
  const sessions = await client.listSessions(opts.botId);

  if (sessions.length === 0) {
    console.log(`No sessions found for bot ${opts.botId}.`);
    return;
  }

  console.log(`Sessions for bot ${opts.botId}:`);
  for (const session of sessions) {
    console.log(`  [${session.id}] ${session.name} (created: ${session.createdAt})`);
  }

  // For each session, fetch the thread and look for pending approvals.
  for (const session of sessions) {
    const thread = await client.getThread({ botId: opts.botId, threadId: session.id });
    const pendingApprovals = thread.messages
      .flatMap((msg) => msg.blocks)
      .filter((b): b is Extract<MessageBlock, { kind: "mcp_approval" }> =>
        b.kind === "mcp_approval" && b.status === "pending",
      );

    if (pendingApprovals.length > 0) {
      console.log(`\nPending approvals in session ${session.id}:`);
      for (const approval of pendingApprovals) {
        console.log(`  - MCP server: ${approval.name} (${approval.serverId})`);
      }
    }
  }
}
