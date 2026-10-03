/**
 * approve — approve a pending MCP server assignment.
 *
 * Usage:
 *   rakazo approve <bot-id> <server-id> [--base-url http://127.0.0.1:3000/rpc]
 */

import { createClient } from "../client.js";
import type { Client } from "../client.js";

export interface ApproveOptions {
  botId: string;
  serverId: string;
  baseUrl: string;
  spaceId: string;
  token?: string;
}

export async function approve(opts: ApproveOptions): Promise<void> {
  const client: Client = createClient({
    baseUrl: opts.baseUrl,
    spaceId: opts.spaceId,
    token: opts.token,
  });

  const result = await client.approveMcpAssignment({
    botId: opts.botId,
    serverId: opts.serverId,
  });

  console.log(`Approved MCP server assignment: ${result.serverId} → status: ${result.status}`);
}
