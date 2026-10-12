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
    const params: Record<string, unknown> = { botId: opts.botId, text: opts.message };
    if (opts.threadId) params.threadId = opts.threadId;
    sent = (await orpcInvoke(
      opts.baseUrl,
      "threads.send",
      params,
      headers,
      fetchImpl,
    )) as SendResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause ? `: ${String(err.cause)}` : "";
    return cliError("GENERAL", `${message}${cause}`);
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      return cliError("TIMEOUT", `bot did not answer within ${timeoutMs}ms`);
    }

    let snap: Snapshot;
    try {
      const params: Record<string, unknown> = { botId: opts.botId };
      if (opts.threadId) params.threadId = opts.threadId;
      snap = (await orpcInvoke(
        opts.baseUrl,
        "threads.get",
        params,
        headers,
        fetchImpl,
      )) as Snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause ? `: ${String(err.cause)}` : "";
      return cliError("GENERAL", `${message}${cause}`);
    }

    // The run that answers this turn: match by id, fall back to the snapshot's
    // current run (a fresh single-thread chat has only one). A finished run
    // disappears from the snapshot, so run === null with a reply is complete.
    const run = snap.run && (snap.run.id === sent.runId || !opts.threadId) ? snap.run : null;
    const reply = snap.messages
      .filter((m) => m.role === "bot" && m.seq > sent.seq)
      .map((m) => textOf(m.blocks))
      .filter(Boolean)
      .join("\n")
      .trim();
    const terminal =
      run === null
        ? reply.length > 0
        : run.status !== "queued" && run.status !== "leased" && run.status !== "running";

    if (terminal) {
      const status = run?.status ?? "completed";
      if (status === "failed") {
        return cliError("GENERAL", "bot run failed; see the thread in the Rakazo web UI");
      }
      return {
        ok: true,
        data: {
          reply,
          threadId: snap.threadId,
          runStatus: status,
          pendingInput: status === "waiting_input" || status === "waiting_takeover",
        },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
