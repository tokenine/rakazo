/**
 * deny — deny (dismiss) a pending MCP server assignment.
 *
 * Usage:
 *   rakazo deny <bot-id> <server-id> [--base-url http://127.0.0.1:3000/rpc]
 */

import type { Client } from "../client.js";
import { createClient } from "../client.js";

export interface DenyOptions {
  botId: string;
  serverId: string;
  baseUrl: string;
  spaceId: string;
  token?: string;
}

export async function deny(opts: DenyOptions): Promise<void> {
  const client: Client = createClient({
    baseUrl: opts.baseUrl,
    spaceId: opts.spaceId,
    token: opts.token,
  });

  const result = await client.denyMcpAssignment({
    botId: opts.botId,
    serverId: opts.serverId,
  });

  console.log(`Denied MCP server assignment: ${result.serverId} → status: ${result.status}`);
}
