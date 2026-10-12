import { Trans } from "@lingui/react/macro";
import { cn } from "@rakazo/ui-web";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { rpc } from "../../lib/rpc";
import { rememberedCodingEngine } from "./session-switcher";

/**
 * The Chat/Code segmented control on the bot header (004 R12): one visible
 * action into code mode. Code reattaches the bot's active coding session or
 * creates one with the remembered engine, then opens the workspace page. The
 * popover path in the session switcher stays for named sessions and engine
 * choice; this control is the primary entry.
 */
export function CodeModeSwitch({ botId, mode }: { botId: string; mode: "chat" | "code" }) {
  const navigate = useNavigate();
  const [entering, setEntering] = useState(false);

  const enterCode = async () => {
    if (mode === "code" || entering) return;
    setEntering(true);
    try {
      const sessions = await rpc.codingSessions.list({ botId });
      const active = sessions.find((session) => session.status === "active");
      if (active) {
        navigate(`/app/code/${active.id}`);
        return;
      }
      const created = await rpc.codingSessions.create({
        botId,
        engine: rememberedCodingEngine(),
      });
      navigate(`/app/code/${created.id}`);
    } catch {
      // Creation failed; the user stays in chat and can retry from the control.
    } finally {
      setEntering(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="Mode"
      data-testid="code-mode-switch"
      className="app-no-drag flex shrink-0 items-center gap-0.5 rounded-lg bg-accent p-0.5"
    >
      <button
        type="button"
        data-testid="code-mode-chat"
        aria-pressed={mode === "chat"}
        className={cn(
          "rounded-md px-2 py-0.5 text-[12.5px]",
          mode === "chat"
            ? "bg-background font-medium text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Trans>Chat</Trans>
      </button>
      <button
        type="button"
        data-testid="code-mode-code"
        aria-pressed={mode === "code"}
        disabled={entering}
        onClick={() => void enterCode()}
        className={cn(
          "rounded-md px-2 py-0.5 text-[12.5px]",
          mode === "code"
            ? "bg-background font-medium text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Trans>Code</Trans>
      </button>
    </div>
  );
}
