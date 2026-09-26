import { Trans, useLingui } from "@lingui/react/macro";
import type { ExpertSummary } from "@rakazo/contracts";
import { EXPERT_AVATARS } from "@rakazo/contracts";
import { BotAvatar, Button, Input } from "@rakazo/ui-web";
import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";

/**
 * AutoClaw-style Expert creation: a card gallery of bundled Experts first,
 * a pre-filled form second. "Blank bot" falls through to the classic form.
 */
export function ExpertCreatePanel({
  onCreated,
  onBlank,
  onCancel,
}: {
  onCreated: (input: { expertKey: string; name?: string; avatarKey?: string }) => Promise<void>;
  onBlank: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [experts, setExperts] = useState<ExpertSummary[] | null>(null);
  const [selected, setSelected] = useState<ExpertSummary | null>(null);
  const [name, setName] = useState("");
  const [avatarKey, setAvatarKey] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.experts
      .list()
      .then(setExperts)
      .catch(() => setExperts([]));
  }, []);

  const avatarChoices = selected
    ? [selected.avatarKey, ...Object.keys(EXPERT_AVATARS)].filter(
        (key, index, all): key is string => Boolean(key) && all.indexOf(key) === index,
      )
    : [];

  async function handleCreate() {
    if (!selected || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onCreated({
        expertKey: selected.key,
        name: name.trim() || undefined,
        avatarKey: avatarKey || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not create the agent`);
      setSubmitting(false);
    }
  }

  if (experts === null) {
    return (
      <div className="py-10 text-center text-[14px] text-muted-foreground/70">
        <Trans>Loading experts…</Trans>
      </div>
    );
  }

  if (selected) {
    return (
      <div data-testid="expert-create-form">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[13.5px] text-muted-foreground">
            <Trans>New agent</Trans>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Back to experts`}
            onClick={() => setSelected(null)}
          >
            <X size={16} strokeWidth={1.8} />
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mb-3 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col items-center gap-1 py-2">
          <BotAvatar
            color={avatarKey ? (EXPERT_AVATARS[avatarKey] ?? selected.color) : selected.color}
            identity={selected.key}
            size={76}
          />
          <span className="mt-1 text-[16px] font-medium text-foreground">{selected.name}</span>
          <span className="text-[13px] text-muted-foreground/80">{selected.title}</span>
        </div>

        <div className="mt-4">
          <div className="text-[14px] text-muted-foreground">
            <Trans>Avatar</Trans>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {avatarChoices.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={avatarKey === key}
                onClick={() => setAvatarKey(key)}
                className={`rounded-full p-0.5 transition ${
                  avatarKey === key ? "ring-2 ring-foreground/50" : "opacity-70 hover:opacity-100"
                }`}
              >
                <img
                  src={EXPERT_AVATARS[key]}
                  alt={key}
                  className="h-11 w-11 rounded-full border border-border object-cover"
                />
              </button>
            ))}
          </div>
        </div>

        <label htmlFor="expert-name" className="mt-4 block text-[14px] text-muted-foreground">
          <Trans>Name</Trans>
          <Input
            id="expert-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={selected.name}
            className="mt-2"
          />
        </label>

        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground/80">
          {selected.description}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {selected.expertiseTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-secondary px-2.5 py-0.5 text-[12px] text-foreground/75"
            >
              {tag}
            </span>
          ))}
        </div>

        {selected.connectors.length ? (
          <div className="mt-4 rounded-xl border border-border/60 px-3 py-3">
            <div className="text-[13.5px] font-medium text-foreground">
              <Trans>Connectors</Trans>
            </div>
            <ul className="mt-2 space-y-1.5">
              {selected.connectors.map((connector) => (
                <li key={connector.slug} className="text-[13px] text-muted-foreground/80">
                  <span className="font-medium text-foreground/85">{connector.name}</span> —{" "}
                  {connector.description}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-muted-foreground/70">
              <Trans>
                Connectors are pre-wired. Authorize each one once from MCP Servers after the agent
                is created.
              </Trans>
            </p>
          </div>
        ) : null}
        {selected.skills.length ? (
          <div className="mt-3 rounded-xl border border-border/60 px-3 py-3">
            <div className="text-[13.5px] font-medium text-foreground">
              <Trans>Bundled skills</Trans>
            </div>
            <ul className="mt-2 space-y-1.5">
              {selected.skills.map((skill) => (
                <li key={skill.name} className="text-[13px] text-muted-foreground/80">
                  <span className="font-medium text-foreground/85">{skill.name}</span> —{" "}
                  {skill.description}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Button className="mt-5 w-full" disabled={submitting} onClick={() => void handleCreate()}>
          {submitting ? (
            <Trans>Creating…</Trans>
          ) : (
            <>
              <Sparkles size={15} strokeWidth={1.8} />
              <Trans>Create &amp; Start</Trans>
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="expert-picker">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13.5px] text-muted-foreground">
          <Trans>New agent</Trans>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={t`Cancel new agent`} onClick={onCancel}>
          <X size={16} strokeWidth={1.8} />
        </Button>
      </div>
      <p className="text-[13px] text-muted-foreground/80">
        <Trans>Pick an Expert — each ships with its own persona, connectors and skills.</Trans>
      </p>
      {experts.length ? (
        <div className="mt-4 grid gap-3">
          {experts.map((expert) => (
            <button
              key={expert.key}
              type="button"
              data-testid={`expert-card-${expert.key}`}
              onClick={() => {
                setSelected(expert);
                setAvatarKey(expert.avatarKey ?? "");
                setName("");
              }}
              className="rounded-2xl border border-border bg-card/60 p-3.5 text-left transition hover:border-foreground/30 hover:bg-card"
            >
              <div className="flex items-start gap-3">
                <BotAvatar
                  color={EXPERT_AVATARS[expert.avatarKey ?? ""] ?? expert.color}
                  identity={expert.key}
                  size={44}
                />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[15px] font-medium text-foreground">{expert.name}</span>
                    <span className="truncate text-[12.5px] text-muted-foreground/70">
                      {expert.title}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground/80">
                    {expert.description}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {expert.expertiseTags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-foreground/70"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-4 border-t border-border/40 pt-4">
        <Button variant="outline" className="w-full" onClick={onBlank}>
          <Trans>Start from scratch</Trans>
        </Button>
      </div>
    </div>
  );
}
