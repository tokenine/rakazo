/**
 * steer — send a steer/prompt line to a bot's thread.
 *
 * Usage:
 *   rakazo steer <bot-id> <message> [--base-url http://127.0.0.1:3000/rpc]
 *   echo "resume the build" | rakazo steer <bot-id> -
 */

import type { Client } from "../client.js";
import { createClient } from "../client.js";

export interface SteerOptions {
  botId: string;
  message: string;
  threadId?: string;
  baseUrl: string;
  spaceId: string;
  token?: string;
}

export async function steer(opts: SteerOptions): Promise<void> {
  const client: Client = createClient({
    baseUrl: opts.baseUrl,
    spaceId: opts.spaceId,
    token: opts.token,
  });

  const result = await client.steer({
    botId: opts.botId,
    message: opts.message,
    threadId: opts.threadId,
  });

  console.log(`Sent steer → taskId: ${result.taskId}, runId: ${result.runId}, seq: ${result.seq}`);
}
