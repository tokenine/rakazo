import { Trans } from "@lingui/react/macro";
import { rpc } from "../../lib/rpc";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface CodingSessionRow {
  id: string;
  workspaceId: string;
  engine: string;
  status: string;
  title: string | null;
}

/**
 * Read-only strip of the bot's coding sessions (004 R12): each pill is the
 * entry into that session's code workspace — terminal, files and git live
 * there, not inline in chat.
 */
export function CodingSessionsStrip({ botId, refreshTick }: { botId: string; refreshTick: number }) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<CodingSessionRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.codingSessions
      .list({ botId })
      .then((rows: CodingSessionRow[]) => {
        if (!cancelled) setSessions(rows);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [botId, refreshTick]);

  if (sessions === null || sessions.length === 0) return null;
  return (
    <div className="flex flex-col px-4 pb-1" data-testid="coding-sessions-strip">
      <div className="flex flex-wrap items-center gap-1.5">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className="flex items-center gap-1.5 rounded-full bg-accent px-2 py-0.5 text-[11.5px] text-foreground/80 hover:text-foreground"
            title={session.title ?? session.workspaceId}
            data-testid={`coding-session-pill-${session.id}`}
            onClick={() => navigate(`/app/code/${session.id}`)}
          >
            <span className="font-medium">
              {session.title ?? <Trans>Coding session</Trans>}
            </span>
            <span className="text-muted-foreground">{session.engine}</span>
            <span
              className={`rounded-full px-1.5 py-0 text-[10px] ${
                session.status === "active" ? "bg-foreground/10" : "bg-muted"
              } text-muted-foreground`}
              data-testid={`coding-session-status-${session.id}`}
            >
              {session.status}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
