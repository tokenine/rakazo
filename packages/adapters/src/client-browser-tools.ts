import type { AdapterContext, AgentToolExecutionResult, ComputerRef } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";

const MAX_CLIENT_JS_CODE = 100_000;
const DEFAULT_CLIENT_TIMEOUT_MS = 60_000;
const MAX_CLIENT_TIMEOUT_MS = 120_000;
const AVAILABILITY_WINDOW_MS = 90_000;
const POLL_INTERVAL_MS = 300;

type ClientJsResult = {
  ok: boolean;
  url: string;
  title: string;
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  error?: string;
};

function textResult(text: string): AgentToolExecutionResult {
  return {
    kind: "agent_tool_result",
    content: [{ type: "text", text }],
    details: null,
  };
}

function richResult(result: ClientJsResult): AgentToolExecutionResult {
  const note = `url: ${result.url || "(none)"}\ntitle: ${result.title || "(none)"}`;
  if (!result.ok) {
    return textResult([result.error ?? "client_js failed.", note].join("\n"));
  }
  const body = `${note}\n${result.text ?? ""}`.trim();
  if (result.imageBase64) {
    return {
      kind: "agent_tool_result",
      content: [
        { type: "text", text: body },
        {
          type: "image",
          data: result.imageBase64,
          mimeType: result.imageMimeType === "image/jpeg" ? "image/jpeg" : "image/png",
        },
      ],
      details: null,
    };
  }
  return { kind: "agent_tool_result", content: [{ type: "text", text: body }], details: null };
}

/**
 * `client_js` — run model-authored JS in the USER's desktop app browser
 * (playwright Page, user's own imported logins). Routed strictly by userId:
 * only the desktop of the same account can receive the command. No approval
 * gate by deployment choice (trust level matches the bot's own shell).
 */
export async function clientBrowserOnline(prisma: PrismaClient, userId: string): Promise<boolean> {
  const session = await prisma.clientBrowserSession.findUnique({ where: { userId } });
  return Boolean(session && Date.now() - session.lastSeenAt.getTime() <= AVAILABILITY_WINDOW_MS);
}

export async function clientJsFromTool(
  prisma: PrismaClient,
  run: { userId: string; threadId: string; id: string },
  context: AdapterContext,
  args: Record<string, unknown>,
  _computer?: ComputerRef,
): Promise<AgentToolExecutionResult> {
  void _computer;
  const session = await prisma.clientBrowserSession.findUnique({
    where: { userId: run.userId },
  });
  if (!session || Date.now() - session.lastSeenAt.getTime() > AVAILABILITY_WINDOW_MS) {
    return textResult(
      "The client browser is not available right now (the user's desktop app is offline or has no heartbeat). Use the bot's own browser tools (browser_navigate/browser_snapshot/browser_act/js) instead.",
    );
  }
  const code = String(args.code ?? "");
  if (!code.trim()) return textResult("client_js requires non-empty code.");
  if (code.length > MAX_CLIENT_JS_CODE) {
    return textResult(`client_js accepts at most ${MAX_CLIENT_JS_CODE} characters of code.`);
  }
  const rawTimeout = Number(args.timeout_ms ?? args.timeoutMs);
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0
      ? Math.min(Math.round(rawTimeout), MAX_CLIENT_TIMEOUT_MS)
      : DEFAULT_CLIENT_TIMEOUT_MS;

  const command = await prisma.clientBrowserCommand.create({
    data: {
      userId: run.userId,
      threadId: run.threadId,
      runId: run.id,
      payload: { code, timeoutMs },
    },
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    context.signal.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const row = await prisma.clientBrowserCommand.findUnique({ where: { id: command.id } });
    if (!row) break;
    if (row.status === "done" || row.status === "error") {
      return richResult(row.result as ClientJsResult);
    }
  }
  return textResult(
    `client_js timed out after ${Math.round(timeoutMs / 1000)}s waiting for the user's desktop app.`,
  );
}
