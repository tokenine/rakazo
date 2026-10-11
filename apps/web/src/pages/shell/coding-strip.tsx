import { Trans } from "@lingui/react/macro";
import { rpc } from "../../lib/rpc.js";
import { CodingSessionTerminal } from "../../components/computer/TerminalApp";
import { useEffect, useState } from "react";

interface CodingSessionRow {
  id: string;
  workspaceId: string;
  engine: string;
  status: string;
  title: string | null;
}

interface AcceptanceState {
  outcome: string;
  verificationCommands: string[];
  recordedAt: string;
}

/**
 * Read-only strip of the bot's coding sessions (004 T6 sliver): shows what the
 * coding surface created and its run status. Each pill expands into an
 * acceptance card (outcome + verification commands) backed by the existing
 * codingAcceptance RPC.
 */
export function CodingSessionsStrip({ botId, refreshTick }: { botId: string; refreshTick: number }) {
  const [sessions, setSessions] = useState<CodingSessionRow[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] text-foreground/80 ${
              expandedId === session.id ? "bg-accent ring-1 ring-ring" : "bg-accent"
            }`}
            title={session.title ?? session.workspaceId}
            aria-expanded={expandedId === session.id}
            data-testid={`coding-session-pill-${session.id}`}
            onClick={() => setExpandedId((current) => (current === session.id ? null : session.id))}
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
      {expandedId ? <AcceptanceCard sessionId={expandedId} /> : null}
      {expandedId ? <SessionTerminalFor sessionId={expandedId} sessions={sessions} /> : null}
    </div>
  );
}

/** Native shell only for active omp sessions; pi sessions stay chat-only. */
function SessionTerminalFor({
  sessionId,
  sessions,
}: {
  sessionId: string;
  sessions: CodingSessionRow[];
}) {
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session || session.engine !== "omp" || session.status !== "active") return null;
  return <CodingSessionTerminal sessionId={sessionId} hidden={false} />;
}

function AcceptanceCard({ sessionId }: { sessionId: string }) {
  const [acceptance, setAcceptance] = useState<AcceptanceState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [commands, setCommands] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    rpc.codingAcceptance
      .get({ sessionId })
      .then((state: AcceptanceState | null) => {
        if (!cancelled) {
          setAcceptance(state);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const record = async () => {
    const trimmedOutcome = outcome.trim();
    const verificationCommands = commands
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!trimmedOutcome || verificationCommands.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const recorded = await rpc.codingAcceptance.record({
        sessionId,
        outcome: trimmedOutcome,
        verificationCommands,
      });
      setAcceptance(recorded as AcceptanceState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the acceptance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-1.5 rounded-xl border border-border p-3 text-[12.5px]"
      data-testid={`acceptance-card-${sessionId}`}
    >
      {loaded && acceptance ? (
        <div>
          <p className="text-foreground/90">
            <Trans>Acceptance recorded</Trans>{" "}
            <span className="text-muted-foreground">
              — {acceptance.outcome} · {acceptance.verificationCommands.length} command(s)
            </span>
          </p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {acceptance.verificationCommands.map((command) => (
              <li key={command} className="font-mono text-[11.5px]">
                {command}
              </li>
            ))}
          </ul>
        </div>
      ) : loaded ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void record();
          }}
        >
          <p className="text-muted-foreground">
            <Trans>
              Record the acceptance verdict for this coding session — the repo-to-PR flow only
              fires once an acceptance exists.
            </Trans>
          </p>
          <input
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            placeholder="Outcome — e.g. all acceptance criteria met"
            aria-label="Acceptance outcome"
            data-testid="acceptance-outcome"
            className="h-8 rounded-lg bg-accent px-2.5 text-foreground outline-none placeholder:text-muted-foreground"
          />
          <textarea
            value={commands}
            onChange={(event) => setCommands(event.target.value)}
            placeholder={"Verification commands, one per line\ne.g. corepack pnpm --filter @rakazo/api test"}
            aria-label="Verification commands"
            data-testid="acceptance-commands"
            rows={3}
            className="rounded-lg bg-accent px-2.5 py-1.5 font-mono text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {error ? <p className="text-destructive">{error}</p> : null}
          <div>
            <button
              type="submit"
              disabled={saving || !outcome.trim() || !commands.trim()}
              className="rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background disabled:opacity-50"
              data-testid="acceptance-record"
            >
              <Trans>Record acceptance</Trans>
            </button>
          </div>
        </form>
      ) : (
        <p className="text-muted-foreground">…</p>
      )}
    </div>
  );
}
