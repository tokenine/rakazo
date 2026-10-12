/**
 * Smoke script — exercises the CLI client without a live server.
 *
 * Run with:  pnpm --filter @rakazo/cli exec tsx src/smoke.ts
 *
 * Requires:
 *   RAKAZO_SPACE_ID=your-space-id
 *   RAKAZO_TOKEN=your-bearer-token   (optional, omit if unauthenticated)
 *
 * Defaults baseUrl to http://127.0.0.1:3000/rpc; override with RAKAZO_BASE_URL.
 */

import { createClient } from "./client.js";

const SPACE_ID = process.env.RAKAZO_SPACE_ID;
const TOKEN: string | undefined = process.env.RAKAZO_TOKEN;
const BASE_URL = process.env.RAKAZO_BASE_URL ?? "http://127.0.0.1:3000/rpc";

if (!SPACE_ID) {
  console.error("Error: RAKAZO_SPACE_ID environment variable is required.");
  process.exit(1);
}
const spaceId: string = SPACE_ID; // narrowed after guard

async function smoke() {
  const client = createClient({ baseUrl: BASE_URL, spaceId, token: TOKEN });

  console.log("[smoke] listing sessions for bot test-bot...");
  try {
    const sessions = await client.listSessions("test-bot");
    console.log(`[smoke] sessions: ${JSON.stringify(sessions)}`);
  } catch (err) {
    console.log(
      `[smoke] listSessions error (expected without live server): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log("[smoke] fetching thread snapshot...");
  try {
    const thread = await client.getThread({ botId: "test-bot" });
    console.log(`[smoke] thread: ${JSON.stringify(thread)}`);
  } catch (err) {
    console.log(
      `[smoke] getThread error (expected without live server): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log("[smoke] sending steer...");
  try {
    const result = await client.steer({ botId: "test-bot", message: "hello from smoke" });
    console.log(`[smoke] steer result: ${JSON.stringify(result)}`);
  } catch (err) {
    console.log(
      `[smoke] steer error (expected without live server): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log("[smoke] done — client constructed and calls attempted without throwing.");
}

smoke();
