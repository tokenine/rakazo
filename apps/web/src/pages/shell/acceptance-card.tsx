import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";

interface AcceptanceState {
  outcome: string;
  verificationCommands: string[];
  recordedAt: string;
}

/**
 * Acceptance verdict for a coding session (004): outcome plus verification
 * commands. Lives in the code workspace rail; the repo-to-PR flow only fires
 * once an acceptance exists.
 */
export function AcceptanceCard({ sessionId }: { sessionId: string }) {
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
      className="rounded-xl border border-border p-3 text-[12.5px]"
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
      ) : null}
    </div>
  );
}
