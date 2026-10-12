/**
 * chat — send a message to a bot's thread and wait for the bot's reply.
 *
 * Uses only existing server procedures: threads.send, then polls threads.get
 * until the run reaches a terminal state. No new server endpoints.
 */

import type { Envelope } from "./output.js";
import { cliError } from "./output.js";
import { orpcInvoke } from "./rpc.js";

export interface ChatResult {
  reply: string;
  threadId: string;
  runStatus: string;
  /** Set when the run parked waiting for the human (question or approval). */
  pendingInput: boolean;
}

export interface ChatOptions {
  botId: string;
  message: string;
  threadId?: string;
  baseUrl: string;
  spaceId: string;
  token?: string;
  fetchImpl?: typeof globalThis.fetch;
  pollMs?: number;
  timeoutMs?: number;
}

interface Snapshot {
  threadId: string;
  run: { id: string; status: string } | null;
  messages: {
    id: string;
    seq: number;
    role: string;
    blocks: { kind: string; text?: string }[];
  }[];
}

interface SendResult {
  taskId: string;
  runId: string;
  seq: number;
}

function textOf(blocks: { kind: string; text?: string }[]): string {
  return blocks
    .filter((b) => b.kind === "text" || b.kind === "ask")
    .map((b) => b.text ?? "")
    .filter(Boolean)
    .join("\n");
}

export async function chat(opts: ChatOptions): Promise<Envelope<ChatResult>> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const pollMs = opts.pollMs ?? 1_000;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const headers: Record<string, string> = {
    "x-rakazo-space-id": opts.spaceId,
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
  };

  let sent: SendResult;
  try {
    sent = (await orpcInvoke(
      opts.baseUrl,
      "threads.send",
      { botId: opts.botId, threadId: opts.threadId ?? null, content: [{ kind: "text", text: opts.message }] },
      headers,
      fetchImpl,
    )) as SendResult;
  } catch (err) {
    return cliError("GENERAL", err instanceof Error ? err.message : String(err));
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      return cliError("TIMEOUT", `bot did not answer within ${timeoutMs}ms`);
    }

    let snap: Snapshot;
    try {
      snap = (await orpcInvoke(
        opts.baseUrl,
        "threads.get",
        { botId: opts.botId, threadId: opts.threadId ?? null },
        headers,
        fetchImpl,
      )) as Snapshot;
    } catch (err) {
      return cliError("GENERAL", err instanceof Error ? err.message : String(err));
    }

    // The run that answers this turn: match by id, fall back to the snapshot's
    // current run (a fresh single-thread chat has only one).
    const run = snap.run && (snap.run.id === sent.runId || !opts.threadId) ? snap.run : null;
    const terminal = run !== null && run.status !== "queued" && run.status !== "leased" && run.status !== "running";

    const reply = snap.messages
      .filter((m) => m.role === "bot" && m.seq > sent.seq)
      .map((m) => textOf(m.blocks))
      .filter(Boolean)
      .join("\n")
      .trim();

    if (terminal) {
      if (run!.status === "failed") {
        return cliError("GENERAL", "bot run failed; see the thread in the Rakazo web UI");
      }
      return {
        ok: true,
        data: {
          reply,
          threadId: snap.threadId,
          runStatus: run!.status,
          pendingInput: run!.status === "waiting_input" || run!.status === "waiting_takeover",
        },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
