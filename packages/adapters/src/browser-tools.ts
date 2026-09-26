import type {
  AdapterContext,
  AgentToolExecutionResult,
  BrowserActKind,
  BrowserActStep,
  BrowserProvider,
  ComputerRef,
} from "@rakazo/adapter-kit";

const MAX_BROWSER_ACTIONS = 24;
const MAX_EVAL_CODE_LENGTH = 100_000;
const MAX_EVAL_TIMEOUT_MS = 120_000;

export async function browserNavigateFromTool(
  browser: BrowserProvider,
  computer: ComputerRef,
  context: AdapterContext,
  args: Record<string, unknown>,
) {
  const url = String(args.url ?? "").trim();
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
      return {
        error: "An HTTP(S) URL without embedded credentials is required",
        fallback: "computer_act" as const,
      };
    }
    const result = await browser.navigate(computer, { url, signal: context.signal }, context);
    return formatBrowserResult(result);
  } catch (error) {
    context.signal.throwIfAborted();
    return {
      error: error instanceof Error ? error.message : String(error),
      fallback: "computer_act" as const,
    };
  }
}

export async function browserSnapshotFromTool(
  browser: BrowserProvider,
  computer: ComputerRef,
  context: AdapterContext,
  args: Record<string, unknown>,
) {
  void args;
  try {
    const result = await browser.snapshot(computer, { signal: context.signal }, context);
    return formatBrowserResult(result);
  } catch (error) {
    context.signal.throwIfAborted();
    return {
      error: error instanceof Error ? error.message : String(error),
      fallback: "computer_act" as const,
    };
  }
}

export async function browserActFromTool(
  browser: BrowserProvider,
  computer: ComputerRef,
  context: AdapterContext,
  args: Record<string, unknown>,
) {
  try {
    const actions = parseBrowserActions(args.actions);
    const result = await browser.act(computer, { actions, signal: context.signal }, context);
    return formatBrowserResult(result);
  } catch (error) {
    context.signal.throwIfAborted();
    return {
      ok: false,
      uncertain: true,
      error: error instanceof Error ? error.message : String(error),
      fallback: "computer_act" as const,
    };
  }
}

export function parseBrowserActions(value: unknown): BrowserActStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("browser_act requires at least one action");
  }
  if (value.length > MAX_BROWSER_ACTIONS) {
    throw new Error(`browser_act accepts at most ${MAX_BROWSER_ACTIONS} actions`);
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`browser_act action ${index} must be an object`);
    }
    const action = raw as Record<string, unknown>;
    const kind = String(action.kind ?? "") as BrowserActKind;
    if (kind !== "click" && kind !== "fill" && kind !== "type") {
      throw new Error(`browser_act action ${index} has unsupported kind`);
    }
    const ref = String(action.ref ?? "").trim();
    if (!ref) throw new Error(`browser_act action ${index} requires ref`);
    if (kind === "fill" || kind === "type") {
      if (typeof action.text !== "string") {
        throw new Error(`browser_act ${kind} requires text`);
      }
      return { kind, ref, text: String(action.text) };
    }
    return { kind, ref };
  });
}

function formatBrowserResult<T extends { fallback?: "computer_act"; error?: string }>(result: T) {
  if (result.fallback === "computer_act") {
    return {
      ...result,
      note: "Page browser could not complete this step. Inspect the current state before continuing with computer_act if available, otherwise request_takeover. Do not replay completed or uncertain actions.",
    };
  }
  return result;
}

/**
 * ZCode-style `js` tool: run the model's JavaScript in the container's browser
 * kernel (playwright-core over CDP against the live Chrome on the display).
 * The kernel exposes `agent.browsers.tab()` (playwright Page + snapshot and
 * screenshot helpers) plus `agent.write()`. Returns text and an optional image
 * as an AgentToolExecutionResult.
 */
export async function browserEvalFromTool(
  browser: BrowserProvider,
  computer: ComputerRef,
  context: AdapterContext,
  args: Record<string, unknown>,
): Promise<AgentToolExecutionResult> {
  const buildTextResult = (text: string, details?: unknown) => ({
    kind: "agent_tool_result" as const,
    content: [{ type: "text" as const, text }],
    details: details ?? null,
  });

  if (typeof browser.evalJs !== "function") {
    return buildTextResult(
      "The js browser kernel is not available on this computer. Use browser_snapshot / browser_act or computer_act instead.",
    );
  }
  const code = String(args.code ?? "");
  if (!code.trim()) {
    return buildTextResult("js requires non-empty code.");
  }
  if (code.length > MAX_EVAL_CODE_LENGTH) {
    return buildTextResult(`js accepts at most ${MAX_EVAL_CODE_LENGTH} characters of code.`);
  }
  const rawTimeout = Number(args.timeout_ms ?? args.timeoutMs);
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0
      ? Math.min(Math.round(rawTimeout), MAX_EVAL_TIMEOUT_MS)
      : undefined;
  try {
    const result = await browser.evalJs(computer, { code, timeoutMs }, context);
    const note = `url: ${result.url || "(none)"}\ntitle: ${result.title || "(none)"}`;
    if (!result.ok) {
      return buildTextResult(
        [
          result.error ?? "The js kernel could not run.",
          note,
          'If the result includes fallback:"computer_act", inspect the state with computer_act instead.',
        ].join("\n"),
        result,
      );
    }
    const parts = result.imageBase64
      ? [
          { type: "text" as const, text: `${note}\n${result.text ?? ""}`.trim() },
          {
            type: "image" as const,
            data: result.imageBase64,
            mimeType:
              result.imageMimeType === "image/jpeg"
                ? ("image/jpeg" as const)
                : ("image/png" as const),
          },
        ]
      : [{ type: "text" as const, text: `${note}\n${result.text ?? ""}`.trim() }];
    return { kind: "agent_tool_result" as const, content: parts, details: null };
  } catch (error) {
    context.signal.throwIfAborted();
    return buildTextResult(error instanceof Error ? error.message : String(error));
  }
}
