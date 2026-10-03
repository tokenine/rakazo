/**
 * @rakazo/cli — CLI for attaching to server-owned sessions, managing approvals, and steering bots.
 *
 * Usage:
 *   rakazo attach <bot-id> [--base-url <url>] [--space-id <id>] [--token <token>]
 *   rakazo approve <bot-id> <server-id> [--base-url <url>] [--space-id <id>] [--token <token>]
 *   rakazo deny <bot-id> <server-id> [--base-url <url>] [--space-id <id>] [--token <token>]
 *   rakazo steer <bot-id> <message> [--base-url <url>] [--space-id <id>] [--token <token>]
 *
 * Environment:
 *   RAKAZO_BASE_URL   default: http://127.0.0.1:3000/rpc
 *   RAKAZO_SPACE_ID   required; the space context for all operations
 *   RAKAZO_TOKEN      optional; Bearer token for auth
 */

import { attach } from "./commands/attach.js";
import { approve } from "./commands/approve.js";
import { deny } from "./commands/deny.js";
import { steer } from "./commands/steer.js";

const BASE_URL = process.env.RAKAZO_BASE_URL ?? "http://127.0.0.1:3000/rpc";
const SPACE_ID = process.env.RAKAZO_SPACE_ID ?? "";
const TOKEN = process.env.RAKAZO_TOKEN;

function usage(code = 1): never {
  console.error(`@rakazo/cli — attach to sessions, manage approvals, steer bots.

Usage:
  rakazo attach  <bot-id>           [--base-url <url>] [--space-id <id>] [--token <t>]
  rakazo approve <bot-id> <server-id> [--base-url <url>] [--space-id <id>] [--token <t>]
  rakazo deny   <bot-id> <server-id> [--base-url <url>] [--space-id <id>] [--token <t>]
  rakazo steer  <bot-id> <message>   [--base-url <url>] [--space-id <id>] [--token <t>]

Environment:
  RAKAZO_BASE_URL  default: http://127.0.0.1:3000/rpc
  RAKAZO_SPACE_ID  required
  RAKAZO_TOKEN     optional Bearer token

Examples:
  rakazo attach  bot_abc123
  rakazo approve bot_abc123 srv_xyz789
  rakazo deny   bot_abc123 srv_xyz789
  rakazo steer  bot_abc123 "resume the build"
`);
  process.exit(code);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!SPACE_ID) {
    console.error("Error: RAKAZO_SPACE_ID environment variable is required.\n");
    usage(1);
  }

  if (!command) usage(0);

  // Parse common flags: --base-url, --space-id, --token (all override env).
  function parseFlags(list: string[]): {
    remaining: string[];
    baseUrl: string;
    spaceId: string;
    token: string | undefined;
  } {
    const remaining: string[] = [];
    let baseUrl = BASE_URL;
    let spaceId = SPACE_ID;
    let token = TOKEN;
    for (let i = 0; i < list.length; i++) {
      const arg = list[i]!;
      if (arg === "--base-url" && i + 1 < list.length) { baseUrl = list[++i]!; continue; }
      if (arg === "--space-id" && i + 1 < list.length) { spaceId = list[++i]!; continue; }
      if (arg === "--token" && i + 1 < list.length) { token = list[++i]!; continue; }
      remaining.push(arg);
    }
    return { remaining, baseUrl, spaceId, token };
  }

  switch (command) {
    case "attach": {
      const { remaining, baseUrl, spaceId, token } = parseFlags(args);
      if (remaining.length < 1) {
        console.error("Error: attach requires <bot-id>\n");
        usage(1);
      }
      await attach({ botId: remaining[0]!, baseUrl, spaceId, token });
      break;
    }
    case "approve": {
      const { remaining, baseUrl, spaceId, token } = parseFlags(args);
      if (remaining.length < 2) {
        console.error("Error: approve requires <bot-id> <server-id>\n");
        usage(1);
      }
      await approve({ botId: remaining[0]!, serverId: remaining[1]!, baseUrl, spaceId, token });
      break;
    }
    case "deny": {
      const { remaining, baseUrl, spaceId, token } = parseFlags(args);
      if (remaining.length < 2) {
        console.error("Error: deny requires <bot-id> <server-id>\n");
        usage(1);
      }
      await deny({ botId: remaining[0]!, serverId: remaining[1]!, baseUrl, spaceId, token });
      break;
    }
    case "steer": {
      const { remaining, baseUrl, spaceId, token } = parseFlags(args);
      if (remaining.length < 2) {
        console.error("Error: steer requires <bot-id> <message>\n");
        usage(1);
      }
      await steer({ botId: remaining[0]!, message: remaining.slice(1).join(" "), baseUrl, spaceId, token });
      break;
    }
    default:
      console.error(`Error: unknown command "${command}"\n`);
      usage(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
