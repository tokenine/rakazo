#!/usr/bin/env node
/**
 * @rakazo/cli — CLI for attaching to server-owned sessions, managing approvals,
 * steering bots, and chatting with a bot from an agent or terminal.
 *
 * Usage:
 *   rakazo chat    <bot-id> "<message>" [--json] [--timeout <ms>]
 *   rakazo login   --server <url> --token <t> --space-id <id>
 *   rakazo logout
 *   rakazo status  [--json]
 *   rakazo attach <bot-id> [--base-url <url>] [--space-id <id>] [--token <token>]
 *   rakazo approve <bot-id> <server-id> [flags]
 *   rakazo deny   <bot-id> <server-id> [flags]
 *   rakazo steer  <bot-id> <message> [flags]
 *
 * Environment:
 *   RAKAZO_BASE_URL   default: http://127.0.0.1:3000/rpc
 *   RAKAZO_SPACE_ID   required (unless logged in)
 *   RAKAZO_TOKEN      optional; Bearer token for auth
 *
 * Auth: stored credentials (~/.config/rakazo/credentials.json) are overridden
 * by env vars and then by flags. Tokens are never printed.
 */

import { chat } from "./chat.js";
import { loadCredentials, removeCredentials, storeCredentials } from "./credentials.js";
import { attach } from "./commands/attach.js";
import { approve } from "./commands/approve.js";
import { deny } from "./commands/deny.js";
import { steer } from "./commands/steer.js";
import { cliError, emit, exitCodeFor } from "./output.js";

const BASE_URL = process.env.RAKAZO_BASE_URL ?? "http://127.0.0.1:3000/rpc";
const SPACE_ID = process.env.RAKAZO_SPACE_ID ?? "";
const TOKEN = process.env.RAKAZO_TOKEN;

function usage(code = 1): never {
  console.error(`@rakazo/cli — chat with bots, attach to sessions, manage approvals, steer.

Usage:
  rakazo chat    <bot-id> "<message>"  [--json] [--timeout <ms>] [--thread-id <id>]
  rakazo login   --server <url> --token <t> --space-id <id>
  rakazo logout
  rakazo status  [--json]
  rakazo attach  <bot-id>             [--base-url <url>] [--space-id <id>] [--token <t>]
  rakazo approve <bot-id> <server-id> [flags]
  rakazo deny   <bot-id> <server-id> [flags]
  rakazo steer  <bot-id> <message>    [flags]

Environment:
  RAKAZO_BASE_URL  default: http://127.0.0.1:3000/rpc
  RAKAZO_SPACE_ID  required (unless stored by login)
  RAKAZO_TOKEN     optional Bearer token

Connection flags (all commands): --base-url, --space-id, --token, --json.
Tokens are stored at ~/.config/rakazo/credentials.json and never printed.

Examples:
  rakazo login  --server https://rakazo.example.com --token tok_xxx --space-id space_1
  rakazo chat   bot_abc123 "run the login tests and tell me what failed" --json
  rakazo steer  bot_abc123 "resume the build"
`);
  process.exit(code);
}

interface Parsed {
  remaining: string[];
  baseUrl: string;
  spaceId: string;
  token: string | undefined;
  json: boolean;
  timeoutMs: number | undefined;
  server: string | undefined;
  threadId: string | undefined;
}

function parseFlags(list: string[]): Parsed {
  const remaining: string[] = [];
  const parsed: Parsed = {
    remaining,
    baseUrl: BASE_URL,
    spaceId: SPACE_ID,
    token: TOKEN,
    json: false,
    timeoutMs: undefined,
    server: undefined,
    threadId: undefined,
  };
  for (let i = 0; i < list.length; i++) {
    const arg = list[i]!;
    const value = () => {
      if (i + 1 >= list.length) usage(2);
      return list[++i]!;
    };
    if (arg === "--base-url" || arg === "--server") { parsed.baseUrl = value(); if (arg === "--server") parsed.server = parsed.baseUrl; continue; }
    if (arg === "--space-id") { parsed.spaceId = value(); continue; }
    if (arg === "--token") { parsed.token = value(); continue; }
    if (arg === "--json") { parsed.json = true; continue; }
    if (arg === "--timeout") { parsed.timeoutMs = Number(value()); continue; }
    if (arg === "--thread-id") { parsed.threadId = value(); continue; }
    remaining.push(arg);
  }
  return parsed;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const parsed = parseFlags(args);
  const stored = loadCredentials();

  if (!command) usage(0);

  if (command === "login") {
    if (!parsed.server) {
      emit(cliError("USAGE", "login requires --server <url>"), { json: parsed.json });
      process.exit(2);
    }
    if (!parsed.token || !parsed.spaceId) {
      emit(
        cliError(
          "USAGE",
          "login requires --token <token> and --space-id <id> (copy the token from your Rakazo web settings)",
        ),
        { json: parsed.json },
      );
      process.exit(2);
    }
    storeCredentials({ server: parsed.server, token: parsed.token, spaceId: parsed.spaceId });
    emit(
      { ok: true, data: { server: parsed.server, spaceId: parsed.spaceId, tokenStored: true } },
      { json: parsed.json, text: `Logged in to ${parsed.server} (token stored, never printed).` },
    );
    return;
  }

  if (command === "logout") {
    removeCredentials();
    emit({ ok: true, data: { loggedOut: true } }, { json: parsed.json, text: "Logged out; stored credentials removed." });
    return;
  }

  if (command === "status") {
    const server = parsed.server ?? stored?.server ?? null;
    const spaceId = parsed.spaceId || stored?.spaceId || null;
    const tokenSet = Boolean(parsed.token ?? stored?.token ?? TOKEN);
    emit(
      {
        ok: true,
        data: { server, spaceId, authenticated: tokenSet, source: stored ? "stored" : TOKEN ? "env" : "none" },
      },
      {
        json: parsed.json,
        text: `server: ${server ?? "not configured"}\nspace: ${spaceId ?? "not configured"}\nauthenticated: ${tokenSet ? "yes" : "no"}`,
      },
    );
    return;
  }

  // Connection resolution for server calls: flags > env > stored credentials.
  const baseUrl = parsed.server ?? parsed.baseUrl;
  const spaceId = parsed.spaceId || stored?.spaceId || "";
  const token = parsed.token ?? stored?.token ?? TOKEN;

  if (!spaceId) {
    console.error("Error: no space id. Set RAKAZO_SPACE_ID or run `rakazo login`.\n");
    usage(1);
  }

  switch (command) {
    case "chat": {
      const rest = parsed.remaining;
      if (rest.length < 2) {
        emit(cliError("USAGE", "chat requires <bot-id> <message>"), { json: parsed.json });
        process.exit(2);
      }
      const result = await chat({
        botId: rest[0]!,
        message: rest.slice(1).join(" "),
        threadId: parsed.threadId,
        baseUrl,
        spaceId,
        token,
        timeoutMs: parsed.timeoutMs,
      });
      if (result.ok) {
        emit(result, {
          json: parsed.json,
          text: result.data.reply || `(run ${result.data.runStatus}${result.data.pendingInput ? ", waiting for your input" : ""})`,
        });
      } else {
        emit(result, { json: parsed.json });
      }
      process.exit(exitCodeFor(result.ok ? undefined : result.error));
    }
    case "attach": {
      if (parsed.remaining.length < 1) {
        console.error("Error: attach requires <bot-id>\n");
        usage(1);
      }
      await attach({ botId: parsed.remaining[0]!, baseUrl, spaceId, token });
      break;
    }
    case "approve": {
      if (parsed.remaining.length < 2) {
        console.error("Error: approve requires <bot-id> <server-id>\n");
        usage(1);
      }
      await approve({ botId: parsed.remaining[0]!, serverId: parsed.remaining[1]!, baseUrl, spaceId, token });
      break;
    }
    case "deny": {
      if (parsed.remaining.length < 2) {
        console.error("Error: deny requires <bot-id> <server-id>\n");
        usage(1);
      }
      await deny({ botId: parsed.remaining[0]!, serverId: parsed.remaining[1]!, baseUrl, spaceId, token });
      break;
    }
    case "steer": {
      if (parsed.remaining.length < 2) {
        console.error("Error: steer requires <bot-id> <message>\n");
        usage(1);
      }
      await steer({ botId: parsed.remaining[0]!, message: parsed.remaining.slice(1).join(" "), baseUrl, spaceId, token });
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
