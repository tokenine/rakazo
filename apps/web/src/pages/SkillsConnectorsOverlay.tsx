import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type {
  AgentSkillCatalogEntry,
  Connection,
  ConnectionCatalogItem,
  ExpertConnectorSummary,
  McpServer,
  SkillStoreCatalogEntry,
} from "@rakazo/contracts";
import { SKILL_STORE_CATEGORIES } from "@rakazo/contracts";
import { abortableDelay, buildFeaturedConnectorTiles } from "@rakazo/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Switch,
  Textarea,
} from "@rakazo/ui-web";
import { Check, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

type Tab = "skills" | "connectors";

type SkillCard = {
  /** DB row id — undefined for store entries not yet installed. */
  id?: string;
  name: string;
  description: string;
  category: string | null;
  enabled: boolean;
  /** Store slug; set ⇒ store install (uninstallable). */
  storeKey: string | null;
  /** Virtual builtins (id `builtin:…`) cannot be toggled or removed. */
  virtual: boolean;
};

function toSkillCard(row: AgentSkillCatalogEntry): SkillCard {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    enabled: row.enabled,
    storeKey: row.storeKey,
    virtual: row.id.startsWith("builtin:"),
  };
}

/**
 * AutoClaw-style Skills & Connectors surface: two tabs over the existing
 * AgentSkill store + connection catalog. The Connectors tab is a launcher —
 * full detail flows (tools, custom sources) stay in Integrations.
 */
export function SkillsConnectorsOverlay({
  onClose,
  onOpenMcp,
  onOpenIntegrations,
  activeBotId,
}: {
  onClose: () => void;
  onOpenMcp?: () => void;
  onOpenIntegrations?: () => void;
  activeBotId?: string;
}) {
  const { t } = useLingui();
  const [tab, setTab] = useState<Tab>("skills");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="skills-connectors"
        showCloseButton={false}
        className="flex h-[min(760px,calc(100%-2rem))] w-[min(1080px,calc(100%-2rem))] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[calc(100%-5rem)] sm:max-w-[1080px]"
      >
        <DialogTitle className="sr-only">Skills & Connectors</DialogTitle>
        <div className="flex items-center gap-1 border-b border-border px-4 py-3">
          <Button variant="ghost" size="icon-sm" aria-label={t`Back`} onClick={onClose}>
            <X />
          </Button>
          <div className="ml-1 flex items-center gap-1">
            <TabButton active={tab === "connectors"} onClick={() => setTab("connectors")}>
              <Trans>Connectors</Trans>
            </TabButton>
            <TabButton active={tab === "skills"} onClick={() => setTab("skills")}>
              <Trans>Skills</Trans>
            </TabButton>
          </div>
          <div className="flex-1" />
          {tab === "skills" ? <NewSkillButton /> : null}
        </div>
        {tab === "skills" ? (
          <SkillsTab />
        ) : (
          <ConnectorsTab
            onOpenMcp={onOpenMcp}
            onOpenIntegrations={onOpenIntegrations}
            activeBotId={activeBotId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={active ? "skills-connectors-tab-active" : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function NewSkillButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} data-testid="new-skill">
        <Plus strokeWidth={2} />
        <Trans>New Skill</Trans>
      </Button>
      {open ? <NewSkillDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewSkillDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await rpc.agentSkills.create({
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        body: body.trim() || undefined,
      });
      window.dispatchEvent(new CustomEvent("rakazo:skills-changed"));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not create skill`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="new-skill-dialog"
        className="w-[min(640px,calc(100%-2rem))] rounded-2xl"
      >
        <DialogTitle className="text-xl font-medium">
          <Trans>New skill</Trans>
        </DialogTitle>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>
            Describe a repeatable recipe. Agents see it in their skill catalog and can load it with
            skill_read.
          </Trans>
        </p>
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="new-skill-name">
              <Trans>Name</Trans>
            </Label>
            <Input
              id="new-skill-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t`e.g. Weekly report`}
              maxLength={80}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-skill-description">
              <Trans>Description</Trans>
            </Label>
            <Input
              id="new-skill-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t`When should agents use this skill?`}
              maxLength={2000}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-skill-body">
              <Trans>Instructions</Trans>
            </Label>
            <Textarea
              id="new-skill-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={8}
              className="font-mono text-[13px]"
              placeholder={t`Steps the agent should follow…`}
            />
          </div>
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            <Trans>Create skill</Trans>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ALL = "__all";
const CUSTOM = "__custom";

function SkillsTab() {
  const { t } = useLingui();
  const [rows, setRows] = useState<AgentSkillCatalogEntry[] | null>(null);
  const [store, setStore] = useState<SkillStoreCatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mySkills, setMySkills] = useState(false);
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    const [list, catalog] = await Promise.all([rpc.agentSkills.list(), rpc.agentSkills.catalog()]);
    setRows(list);
    setStore(catalog);
  }

  useEffect(() => {
    let cancelled = false;
    refresh()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t`Could not load skills`);
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    const onChanged = () => {
      void refresh().catch(() => undefined);
    };
    window.addEventListener("rakazo:skills-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("rakazo:skills-changed", onChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const installedByStoreKey = useMemo(() => {
    const map = new Map<string, AgentSkillCatalogEntry>();
    for (const row of rows ?? []) {
      if (row.storeKey) map.set(row.storeKey, row);
    }
    return map;
  }, [rows]);

  const myCards = useMemo(() => (rows ?? []).map(toSkillCard), [rows]);

  const storeCards: SkillCard[] = useMemo(
    () =>
      (store ?? []).map((entry) => {
        const row = installedByStoreKey.get(entry.key);
        return {
          name: entry.name,
          description: entry.description,
          category: entry.category,
          enabled: row?.enabled ?? true,
          storeKey: entry.key,
          virtual: false,
          id: row?.id,
        };
      }),
    [store, installedByStoreKey],
  );

  const cards = useMemo(() => {
    const base = mySkills ? myCards : storeCards;
    const needle = query.trim().toLowerCase();
    return base.filter((card) => {
      if (!mySkills && card.virtual) return false;
      if (category === CUSTOM) {
        if (!mySkills || card.storeKey || card.virtual) return false;
      } else if (category !== ALL && card.category !== category) {
        return false;
      }
      if (needle && !`${card.name}\n${card.description}`.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [mySkills, myCards, storeCards, category, query]);

  const installedCount = myCards.filter((card) => !card.virtual).length;

  async function install(card: SkillCard) {
    if (!card.storeKey) return;
    setBusy(`install:${card.storeKey}`);
    setError(null);
    try {
      await rpc.agentSkills.install({ key: card.storeKey });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not install skill`);
    } finally {
      setBusy(null);
    }
  }

  async function uninstall(card: SkillCard) {
    if (!card.id) return;
    setBusy(`uninstall:${card.id}`);
    setError(null);
    try {
      if (card.storeKey) {
        await rpc.agentSkills.uninstall({ skillId: card.id });
      } else {
        await rpc.agentSkills.remove({ skillId: card.id });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not remove skill`);
    } finally {
      setBusy(null);
    }
  }

  async function setEnabled(card: SkillCard, enabled: boolean) {
    if (!card.id || card.virtual) return;
    setBusy(`enabled:${card.id}`);
    setError(null);
    try {
      await rpc.agentSkills.setEnabled({ skillId: card.id, enabled });
      setMyCardsEnabled(card.id, enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not update skill`);
    } finally {
      setBusy(null);
    }
  }

  function setMyCardsEnabled(skillId: string, enabled: boolean) {
    setRows((current) =>
      (current ?? []).map((row) => (row.id === skillId ? { ...row, enabled } : row)),
    );
  }

  const chips = mySkills
    ? [ALL, CUSTOM, ...SKILL_STORE_CATEGORIES]
    : [ALL, ...SKILL_STORE_CATEGORIES];

  return (
    <div className="rk-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-8 sm:px-10">
      <div className="flex items-start justify-between gap-4 pt-6">
        <div>
          <h2 className="text-2xl font-medium text-foreground">
            {mySkills ? (
              <Trans>
                My skills <span className="text-muted-foreground">{installedCount}</span>
              </Trans>
            ) : (
              <Trans>Teach your agents new skills</Trans>
            )}
          </h2>
          <p className="mt-1 max-w-[560px] text-[13.5px] text-muted-foreground">
            {mySkills ? (
              <Trans>
                Everything installed for your account. Disable a skill to hide it from your agents
                without uninstalling.
              </Trans>
            ) : (
              <Trans>
                Curated, ready-to-use skills. Install one and every assistant can load it when a
                request matches.
              </Trans>
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid="my-skills-toggle"
          onClick={() => setMySkills((value) => !value)}
        >
          {mySkills ? (
            <Trans>Skill Store</Trans>
          ) : (
            <Plural value={installedCount} one="# my skill" other="# my skills" />
          )}
        </Button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            data-testid={`skill-chip-${chip}`}
            onClick={() => setCategory(chip)}
            className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
              category === chip
                ? "border-foreground bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {chip === ALL ? t`All` : chip === CUSTOM ? t`Created by me` : chip}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t`Search skills`}
              className="w-[220px] pl-8"
            />
          </div>
        </div>
      </div>

      {error ? <p className="mt-4 text-[13px] text-destructive">{error}</p> : null}

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="skills-grid">
        {rows === null || store === null ? (
          <>
            <Skeleton className="h-[118px] rounded-xl" />
            <Skeleton className="h-[118px] rounded-xl" />
            <Skeleton className="h-[118px] rounded-xl" />
            <Skeleton className="h-[118px] rounded-xl" />
          </>
        ) : cards.length === 0 ? (
          <p className="col-span-full py-10 text-center text-[13.5px] text-muted-foreground">
            <Trans>No skills match.</Trans>
          </p>
        ) : (
          cards.map((card) => (
            <SkillCardView
              key={card.id ?? `store:${card.storeKey}`}
              card={card}
              mySkills={mySkills}
              busy={busy !== null}
              onInstall={() => void install(card)}
              onUninstall={() => void uninstall(card)}
              onEnabled={(enabled) => void setEnabled(card, enabled)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SkillCardView({
  card,
  mySkills,
  busy,
  onInstall,
  onUninstall,
  onEnabled,
}: {
  card: SkillCard;
  mySkills: boolean;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onEnabled: (enabled: boolean) => void;
}) {
  const installed = Boolean(card.id);
  return (
    <div
      data-testid={`skill-card-${card.storeKey ?? card.id}`}
      className="flex flex-col justify-between rounded-xl border border-border bg-card p-4"
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-medium text-foreground">{card.name}</h3>
          {mySkills ? null : installed ? (
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground"
              title="Installed"
              data-testid="skill-installed"
            >
              <Check className="size-4" strokeWidth={2} />
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Install ${card.name}`}
              disabled={busy}
              onClick={onInstall}
            >
              <Plus className="size-4" strokeWidth={2} />
            </Button>
          )}
        </div>
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
          {card.description}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted-foreground/80">
          {card.storeKey ? "Ai7 store" : card.virtual ? "Built-in" : "Created by me"}
        </span>
        {mySkills && !card.virtual ? (
          <div className="flex items-center gap-2">
            <Switch
              checked={card.enabled}
              disabled={busy}
              onCheckedChange={onEnabled}
              aria-label={card.enabled ? `Disable ${card.name}` : `Enable ${card.name}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${card.name}`}
              disabled={busy}
              className="text-muted-foreground hover:text-destructive"
              onClick={onUninstall}
            >
              <Trash2 className="size-4" strokeWidth={1.75} />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConnectorsTab({
  onOpenMcp,
  onOpenIntegrations,
  activeBotId,
}: {
  onOpenMcp?: () => void;
  onOpenIntegrations?: () => void;
  activeBotId?: string;
}) {
  const { t } = useLingui();
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[] | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [bundled, setBundled] = useState<ExpertConnectorSummary[] | null>(null);
  const [bundledServers, setBundledServers] = useState<McpServer[]>([]);
  const [addingSlug, setAddingSlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<AbortController | null>(null);

  async function refresh(): Promise<ConnectionCatalogItem[]> {
    const [items, rows, bundledList, mcpList] = await Promise.all([
      rpc.connections.catalog({}),
      rpc.connections.list(),
      rpc.experts.connectors(),
      rpc.mcp.servers.list(),
    ]);
    setCatalog(items);
    setConnections(rows);
    setBundled(bundledList);
    setBundledServers(mcpList);
    return items;
  }

  function bundledServer(slug: string) {
    return bundledServers.find((entry) => entry.slug === slug);
  }

  function bundledConnected(slug: string) {
    return bundledServer(slug)?.oauthStatus === "connected";
  }

  async function addBundled(connector: ExpertConnectorSummary) {
    setAddingSlug(connector.slug);
    setError(null);
    try {
      await rpc.mcp.servers.create({
        slug: connector.slug,
        name: connector.name,
        description: connector.description,
        enabled: true,
        transport: "streamable_http",
        endpoint: connector.endpoint,
        headers: {},
      });
      setBundledServers(await rpc.mcp.servers.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not add connector`);
    } finally {
      setAddingSlug(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    refresh().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : t`Could not load connectors`);
    });
    return () => {
      cancelled = true;
      attempt.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function activeAccounts(item: Pick<ConnectionCatalogItem, "connectorId" | "slug">) {
    return connections.filter(
      (row) =>
        row.connectorId === item.connectorId &&
        row.provider === item.slug &&
        (row.status === "connected" || row.status === "pending"),
    );
  }

  function isConnected(item: ConnectionCatalogItem) {
    return item.connected || activeAccounts(item).some((row) => row.status === "connected");
  }

  function notifyAppConnected(item: ConnectionCatalogItem) {
    if (!activeBotId) return;
    void rpc.onboarding
      .appConnected({ botId: activeBotId, provider: item.slug, connectorId: item.connectorId })
      .catch(() => undefined);
  }

  async function connect(item: ConnectionCatalogItem) {
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setError(null);
    setPending(`${item.connectorId}:${item.slug}`);
    try {
      const started = await rpc.connections.begin({
        connectorId: item.connectorId,
        provider: item.slug,
        displayName: item.name,
      });
      if (started.authorizationUrl) {
        window.open(started.authorizationUrl, "rakazo-plugin-connect", "noopener,noreferrer");
      }
      if (item.noAuth && !started.authorizationUrl) {
        if (controller.signal.aborted) return;
        notifyAppConnected(item);
        await refresh().catch(() => undefined);
        return;
      }
      for (let i = 0; i < 45; i += 1) {
        if (controller.signal.aborted) return;
        const row = await rpc.connections
          .complete({ connectionId: started.connectionId })
          .catch(() => undefined);
        if (row?.status === "connected") {
          if (controller.signal.aborted) return;
          notifyAppConnected(item);
          await refresh().catch(() => undefined);
          return;
        }
        await abortableDelay(2_000, controller.signal);
      }
      if (controller.signal.aborted) return;
      setError(t`Connection to ${item.name} is still pending. Check again in a moment.`);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : t`Could not connect`);
    } finally {
      if (attempt.current === controller) {
        attempt.current = null;
        setPending(null);
      }
    }
  }

  async function disconnect(item: ConnectionCatalogItem) {
    setPending(`${item.connectorId}:${item.slug}`);
    setError(null);
    try {
      for (const row of activeAccounts(item)) {
        await rpc.connections.revoke({ connectionId: row.id });
      }
      await refresh().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not revoke connection`);
    } finally {
      setPending(null);
    }
  }

  const tiles = useMemo(() => (catalog ? buildFeaturedConnectorTiles(catalog) : null), [catalog]);

  const extraItems = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return catalog
      .filter(
        (item) =>
          item.name.toLowerCase().includes(needle) || item.slug.toLowerCase().includes(needle),
      )
      .slice(0, 24);
  }, [catalog, query]);

  const featuredVisible = useMemo(() => {
    const withItem = (tiles ?? []).flatMap((tile) => (tile.item ? [tile.item] : []));
    if (!connectedOnly) return withItem;
    return withItem.filter((item) => isConnected(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, connectedOnly, connections]);

  const bundledVisible = useMemo(() => {
    const list = bundled ?? [];
    const needle = query.trim().toLowerCase();
    return list.filter((entry) => {
      if (
        needle &&
        !`${entry.name}\n${entry.slug}\n${entry.description}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (connectedOnly && !bundledConnected(entry.slug)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundled, bundledServers, query, connectedOnly]);

  const connectedCount = useMemo(() => {
    const fromCatalog = (catalog ?? []).filter((item) => isConnected(item)).length;
    const fromBundled = (bundled ?? []).filter((entry) => bundledConnected(entry.slug)).length;
    return fromCatalog + fromBundled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, connections, bundled, bundledServers]);

  const catalogEmpty = (catalog?.length ?? 0) === 0;

  return (
    <div className="rk-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-8 sm:px-10">
      <div className="flex items-start justify-between gap-4 pt-6">
        <div>
          <h2 className="text-2xl font-medium text-foreground">
            <Trans>Connect external apps for a smoother workflow</Trans>
          </h2>
          <p className="mt-1 max-w-[560px] text-[13.5px] text-muted-foreground">
            <Trans>
              Link the services your agents are allowed to touch. Connections are shared across all
              your assistants.
            </Trans>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t`Refresh connectors`}
          onClick={() => void refresh().catch(() => undefined)}
        >
          <RefreshCw className="size-4" strokeWidth={1.75} />
        </Button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setConnectedOnly(false)}
          className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
            !connectedOnly
              ? "border-foreground bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Trans>All</Trans>
        </button>
        <button
          type="button"
          data-testid="connectors-connected-chip"
          onClick={() => setConnectedOnly(true)}
          className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
            connectedOnly
              ? "border-foreground bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Trans>
            Connected <span className="tabular-nums">{connectedCount}</span>
          </Trans>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t`Search connectors`}
              className="w-[220px] pl-8"
            />
          </div>
        </div>
      </div>

      {error ? <p className="mt-4 text-[13px] text-destructive">{error}</p> : null}

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="connectors-grid">
        {catalog === null || bundled === null ? (
          <>
            <Skeleton className="h-[92px] rounded-xl" />
            <Skeleton className="h-[92px] rounded-xl" />
          </>
        ) : (
          <>
            {bundledVisible.map((entry) => {
              const connected = bundledConnected(entry.slug);
              return (
                <div
                  key={`bundled:${entry.slug}`}
                  data-testid={`connector-card-${entry.slug}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent text-[15px] font-medium text-foreground/80">
                    {entry.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[14.5px] font-medium text-foreground">
                        {entry.name}
                      </h3>
                      {connected ? (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11.5px] text-success">
                          <Trans>Connected</Trans>
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                      {entry.description}
                    </p>
                  </div>
                  {bundledServer(entry.slug) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground"
                      onClick={onOpenMcp}
                    >
                      {connected ? <Trans>Manage</Trans> : <Trans>Authorize</Trans>}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Add ${entry.name}`}
                      disabled={addingSlug === entry.slug}
                      data-testid={`add-connector-${entry.slug}`}
                      onClick={() => void addBundled(entry)}
                    >
                      <Plus className="size-4" strokeWidth={2} />
                    </Button>
                  )}
                </div>
              );
            })}
            {featuredVisible.map((item) => (
              <ConnectorCard
                key={`${item.connectorId}:${item.slug}`}
                item={item}
                connected={isConnected(item)}
                busy={pending === `${item.connectorId}:${item.slug}`}
                onConnect={() => void connect(item)}
                onDisconnect={() => void disconnect(item)}
              />
            ))}
            {extraItems.map((item) => (
              <ConnectorCard
                key={`${item.connectorId}:${item.slug}`}
                item={item}
                connected={isConnected(item)}
                busy={pending === `${item.connectorId}:${item.slug}`}
                onConnect={() => void connect(item)}
                onDisconnect={() => void disconnect(item)}
              />
            ))}
            {bundledVisible.length === 0 &&
            featuredVisible.length === 0 &&
            extraItems.length === 0 ? (
              <p className="col-span-full py-10 text-center text-[13.5px] text-muted-foreground">
                {catalogEmpty && !query.trim() ? (
                  <Trans>Configure a plugin catalog on the server to connect apps.</Trans>
                ) : (
                  <Trans>No connectors match.</Trans>
                )}
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {onOpenMcp ? (
          <Button type="button" variant="secondary" size="sm" onClick={onOpenMcp}>
            <Trans>Manage MCP servers</Trans>
          </Button>
        ) : null}
        {onOpenIntegrations ? (
          <Button type="button" variant="ghost" size="sm" onClick={onOpenIntegrations}>
            <Trans>Browse all integrations</Trans>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ConnectorCard({
  item,
  connected,
  busy,
  onConnect,
  onDisconnect,
}: {
  item: ConnectionCatalogItem;
  connected: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div
      data-testid={`connector-card-${item.slug}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
    >
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent text-[15px] font-medium text-foreground/80">
        {item.logo ? (
          <img src={item.logo} alt="" className="size-6 object-contain" />
        ) : (
          item.name.slice(0, 1).toUpperCase()
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[14.5px] font-medium text-foreground">{item.name}</h3>
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{item.slug}</p>
      </div>
      {connected ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onDisconnect}
          className="text-muted-foreground"
        >
          <Check className="size-4" strokeWidth={2} />
          <Trans>Connected</Trans>
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Connect ${item.name}`}
          disabled={busy}
          onClick={onConnect}
        >
          <Plus className="size-4" strokeWidth={2} />
        </Button>
      )}
    </div>
  );
}
