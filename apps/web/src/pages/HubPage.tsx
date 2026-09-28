import { Trans } from "@lingui/react/macro";
import { useNavigate } from "react-router-dom";
import type { InspirationCase } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { Bot, Cpu, MessageSquare, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

/** Zone titles — enforced 2-word copy budget */
const ZONE_GREETING = "ยินดีต้อนรับ"; // per design brief greeting copy
const ZONE_ACTIVITY = "Activity"; // zone title 2 words
const ZONE_GALLERY = "Gallery"; // zone title 2 words
const ZONE_FIRST_ACTIONS = "Start"; // zone title 2 words

type FirstAction =
  | { kind: "create-agent"; label: string; href: string }
  | { kind: "connect-model"; label: string; href: string }
  | { kind: "connect-telegram"; label: string; href: string };

interface HubPageProps {
  /** Whether the current space has any content (bots or groups). */
  hasContent: boolean;
  /** Bots in the current space for the Activity zone. */
  bots?: Array<{ id: string; name: string; color?: string }>;
  /** Pre-fetched recent runs for the Activity zone. */
  recentRuns?: Array<{ id: string; botName: string; promptSnippet: string }>;
}

export function HubPage({ hasContent, bots = [] }: HubPageProps) {
  const navigate = useNavigate();
  const [cases, setCases] = useState<InspirationCase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    rpc.inspiration
      .list()
      .then(setCases)
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }, []);

  const firstActions: FirstAction[] = [
    {
      kind: "create-agent",
      label: "Create agent",
      href: "/app",
    },
    {
      kind: "connect-model",
      label: "Connect model",
      href: "/integrations/setup",
    },
    {
      kind: "connect-telegram",
      label: "Connect Telegram",
      href: "/integrations/setup",
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Greeting header — 1 line per copy budget */}
      <div className="border-b border-border px-6 py-5">
        <p className="text-[15px] font-medium text-foreground">
          {hasContent ? (
            <Trans>Welcome back</Trans>
          ) : (
            <Trans>Welcome — let's get started</Trans>
          )}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-8 px-6 py-6">
        {/* Activity zone — bot previews; always renders (empty-safe) */}
        <section>
          <h2 className="mb-3 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
            <Trans>{ZONE_ACTIVITY}</Trans>
          </h2>
          {bots.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {bots.slice(0, 8).map((bot) => (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => navigate(`/app/${bot.id}`)}
                  className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-start transition-colors hover:bg-accent"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                    style={{ backgroundColor: bot.color ?? "#6B7280" }}
                  >
                    {bot.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 truncate text-[13.5px] text-foreground">
                    {bot.name}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">
              <Trans>No agents yet — create your first one below</Trans>
            </p>
          )}
        </section>

        {/* Gallery rail — always visible; inspiration cases are context, not content */}
        <section>
          <h2 className="mb-3 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
            <Trans>{ZONE_GALLERY}</Trans>
          </h2>
          {loading ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-36 w-56 shrink-0 animate-pulse rounded-xl bg-muted"
                />
              ))}
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {cases.map((c) => (
                <GalleryCard key={c.key} case_={c} />
              ))}
            </div>
          )}
        </section>

        {/* First-actions — only when empty */}
        {!hasContent && (
          <section>
            <h2 className="mb-3 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
              <Trans>{ZONE_FIRST_ACTIONS}</Trans>
            </h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              {firstActions.map((action) => (
                <FirstActionCard key={action.kind} action={action} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function GalleryCard({ case_ }: { case_: InspirationCase }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  async function handleMakeSimilar() {
    setCreating(true);
    try {
      const bot = await rpc.bots.createFromExpert({
        expertKey: case_.expertKey,
        name: case_.title,
      });
      navigate(`/app/${bot.id}/${bot.threadId}`);
    } catch {
      navigate("/app");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      data-testid={`inspiration-card-${case_.key}`}
      className="flex w-56 shrink-0 flex-col rounded-xl border border-border bg-card overflow-hidden"
    >
      {/* Visual asset — grayscale SVG */}
      <div className="h-24 bg-muted flex items-center justify-center p-3">
        <img
          src={`/assets/inspiration/${case_.visualAssetPath}`}
          alt=""
          className="h-full w-auto object-contain"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <p className="text-[14px] font-medium text-foreground">{case_.title}</p>
          <p className="text-[12px] text-muted-foreground line-clamp-1">
            {case_.description}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleMakeSimilar}
          disabled={creating}
          className="mt-auto w-full"
        >
          {creating ? (
            <Trans>Creating…</Trans>
          ) : (
            <Trans>Make similar</Trans>
          )}
        </Button>
      </div>
    </div>
  );
}

function FirstActionCard({ action }: { action: FirstAction }) {
  const navigate = useNavigate();

  const icon = {
    "create-agent": <Bot size={18} strokeWidth={1.6} className="text-muted-foreground" />,
    "connect-model": <Cpu size={18} strokeWidth={1.6} className="text-muted-foreground" />,
    "connect-telegram": (
      <MessageSquare size={18} strokeWidth={1.6} className="text-muted-foreground" />
    ),
  };

  return (
    <button
      type="button"
      onClick={() => navigate(action.href)}
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-start transition-colors hover:bg-accent"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        {icon[action.kind]}
      </span>
      <span className="text-[14px] text-foreground">{action.label}</span>
    </button>
  );
}
