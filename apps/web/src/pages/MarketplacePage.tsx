import { Trans } from "@lingui/react/macro";
import type { AgentBundle, CatalogEntry, ImportPreview } from "@rakazo/contracts";
import {
  BotAvatar,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
} from "@rakazo/ui-web";
import { AlertTriangle, CheckCircle, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { rpc } from "../lib/rpc";

const KIND_FILTERS = ["agent", "skill", "mcp"] as const;
type KindFilter = (typeof KIND_FILTERS)[number] | "all";

const PROVENANCE_LABELS: Record<string, string> = {
  bundled: "Bundled",
  operator: "Operator",
  registry: "Registry",
};

const KIND_LABELS: Record<string, string> = {
  agent: "Agent",
  skill: "Skill",
  mcp: "MCP Server",
};

function ProvenanceBadge({ provenance }: { provenance: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-foreground/20 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {PROVENANCE_LABELS[provenance] ?? provenance}
    </span>
  );
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}

function MarketplaceCard({
  entry,
  onInstall,
  onCardClick,
}: {
  entry: CatalogEntry;
  onInstall: (entry: CatalogEntry) => void;
  onCardClick: (entry: CatalogEntry) => void;
}) {
  return (
    <Card
      className="group/card relative flex cursor-pointer flex-col"
      data-testid={`marketplace-card-${entry.id}`}
      onClick={() => onCardClick(entry)}
    >
      <CardHeader className="flex flex-row items-start gap-3 pb-2">
        <BotAvatar
          color={entry.avatarKey ?? ""}
          identity={entry.name}
          size={40}
          className="flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{entry.title}</CardTitle>
          <div className="mt-1 flex flex-wrap gap-1">
            <ProvenanceBadge provenance={entry.provenance} />
            <KindBadge kind={entry.kind} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 pt-0">
        <CardDescription className="line-clamp-2 text-muted-foreground">
          {entry.description}
        </CardDescription>
        <div className="mt-auto flex items-center justify-end pt-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => onInstall(entry)}
            data-testid={`install-${entry.id}`}
          >
            <Trans>Install</Trans>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailDrawer({
  entry,
  open,
  onClose,
  onInstall,
}: {
  entry: CatalogEntry | null;
  open: boolean;
  onClose: () => void;
  onInstall: (entry: CatalogEntry) => void;
}) {
  if (!entry) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex flex-row items-start gap-3">
            <BotAvatar color={entry.avatarKey ?? ""} identity={entry.name} size={48} />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{entry.title}</DialogTitle>
              <div className="mt-1 flex flex-wrap gap-1">
                <ProvenanceBadge provenance={entry.provenance} />
                <KindBadge kind={entry.kind} />
              </div>
            </div>
          </div>
          <DialogDescription className="mt-3">{entry.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button
            size="sm"
            variant="default"
            onClick={() => onInstall(entry)}
            data-testid="drawer-install"
          >
            <Trans>Install</Trans>
          </Button>
          <DialogClose
            render={
              <Button size="sm" variant="ghost">
                <Trans>Close</Trans>
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ImportPhase = "idle" | "loading" | "review" | "committing" | "success" | "error";

interface ImportState {
  phase: ImportPhase;
  preview?: ImportPreview;
  importToken?: string;
  error?: string;
}

function ImportReviewModal({
  bundleJson,
  open,
  onClose,
  onSuccess,
}: {
  bundleJson: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [state, setState] = useState<ImportState>({ phase: "idle" });

  useEffect(() => {
    if (!open) {
      setState({ phase: "idle" });
      return;
    }
    setState({ phase: "loading" });
    rpc.agents
      .previewImport({ bundleJson })
      .then((preview: ImportPreview) => {
        setState({ phase: "review", preview, importToken: preview.importToken });
      })
      .catch((err: { message?: string }) => {
        setState({ phase: "error", error: err?.message ?? "Preview failed" });
      });
  }, [open, bundleJson]);

  function handleConfirm() {
    if (!state.importToken) return;
    setState((prev) => ({ ...prev, phase: "committing" }));
    rpc.agents
      .import({ importToken: state.importToken, confirm: true })
      .then(() => {
        setState((prev) => ({ ...prev, phase: "success" }));
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
      })
      .catch((err: { message?: string }) => {
        setState((prev) => ({ ...prev, phase: "error", error: err?.message ?? "Import failed" }));
      });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Review Install</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Review the details before installing this agent.</Trans>
          </DialogDescription>
        </DialogHeader>

        {state.phase === "loading" || state.phase === "idle" ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner className="size-6" />
          </div>
        ) : state.phase === "error" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={16} />
              <span className="font-medium text-sm">
                <Trans>Install refused</Trans>
              </span>
            </div>
            <p className="text-sm text-destructive">{state.error}</p>
          </div>
        ) : state.phase === "success" ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <CheckCircle size={32} className="text-green-600" />
            <p className="font-medium text-sm">
              <Trans>Agent installed successfully</Trans>
            </p>
          </div>
        ) : (
          <>
            {state.preview && (
              <div className="flex flex-col gap-3">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm font-medium">{state.preview.manifest.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {state.preview.manifest.description}
                  </p>
                </div>

                {state.preview.skills.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      <Trans>Skills ({state.preview.skills.length})</Trans>
                    </p>
                    <ul className="flex flex-col gap-1">
                      {state.preview.skills.map((s) => (
                        <li key={s.name} className="flex items-center gap-2 text-sm">
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                            {s.name}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {s.description}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {state.preview.mcpServers.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      <Trans>MCP Servers ({state.preview.mcpServers.length})</Trans>
                    </p>
                    <ul className="flex flex-col gap-1">
                      {state.preview.mcpServers.map((m) => (
                        <li key={m.slug} className="flex items-center gap-2 text-sm">
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                            {m.slug}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {m.transport} — {m.endpoint}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {state.preview.secretFlaggedFields &&
                  state.preview.secretFlaggedFields.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>
                        <Trans>Some fields were flagged during security review:</Trans>{" "}
                        {state.preview.secretFlaggedFields.join(", ")}
                      </span>
                    </div>
                  )}

                <p className="text-xs text-muted-foreground">
                  <Trans>
                    MCP servers will be installed with allowAllTools=false. Review endpoint URLs
                    before confirming.
                  </Trans>
                </p>
              </div>
            )}

            <DialogFooter className="mt-2">
              {state.phase === "committing" ? (
                <div className="flex h-8 items-center gap-2">
                  <Spinner className="size-4" />
                  <span className="text-sm text-muted-foreground">
                    <Trans>Installing…</Trans>
                  </span>
                </div>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleConfirm}
                    data-testid="confirm-install"
                  >
                    <Trans>Confirm Install</Trans>
                  </Button>
                  <DialogClose
                    render={
                      <Button size="sm" variant="ghost">
                        <Trans>Cancel</Trans>
                      </Button>
                    }
                  />
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MarketplacePage() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<KindFilter>("all");

  const [selectedEntry, setSelectedEntry] = useState<CatalogEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [installBundleJson, setInstallBundleJson] = useState("");

  const filtered = useMemo(() => {
    let result = entries;
    if (activeFilter !== "all") {
      result = result.filter((e) => e.kind === activeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q),
      );
    }
    return result;
  }, [entries, search, activeFilter]);

  useEffect(() => {
    let cancelled = false;
    rpc.marketplace
      .list({})
      .then((res: { entries: CatalogEntry[] }) => {
        if (!cancelled) setEntries(res.entries);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCardClick = useCallback((entry: CatalogEntry) => {
    setSelectedEntry(entry);
    setDrawerOpen(true);
  }, []);

  const handleInstallFromDrawer = useCallback((entry: CatalogEntry) => {
    setDrawerOpen(false);
    // Build a minimal bundle from the catalog entry.
    // Bundled entries map to an expert; real bundles come from the operator.
    // This is the seam where a real bundle download/lookup would happen.
    const bundle: AgentBundle = {
      version: "1",
      exportedAt: new Date().toISOString(),
      manifest: {
        name: entry.name,
        title: entry.title,
        description: entry.description,
        instructions: "",
        avatarKey: entry.avatarKey ?? undefined,
        expertKey: entry.id.replace("bundled:", ""),
        modelProvider: undefined,
        modelId: undefined,
        thinkingLevel: undefined,
      },
      skills: [],
      mcpServers: [],
    };
    setInstallBundleJson(JSON.stringify(bundle));
    setModalOpen(true);
  }, []);

  const handleInstallFromCard = useCallback(
    (entry: CatalogEntry) => {
      handleInstallFromDrawer(entry);
    },
    [handleInstallFromDrawer],
  );

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleSuccess = useCallback(() => {
    // Could navigate to the installed agent's thread.
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-background/95 p-4 backdrop-blur-sm">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="Search agents, skills, MCP servers…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            className="pl-9 pr-8"
            aria-label="Search marketplace"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Kind filter chips */}
        <fieldset className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={activeFilter === "all" ? "default" : "ghost"}
            onClick={() => setActiveFilter("all")}
            aria-pressed={activeFilter === "all"}
          >
            <Trans>All</Trans>
          </Button>
          {KIND_FILTERS.map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant={activeFilter === kind ? "default" : "ghost"}
              onClick={() => setActiveFilter(kind)}
              aria-pressed={activeFilter === kind}
            >
              <Trans>{kind.charAt(0).toUpperCase() + kind.slice(1)}s</Trans>
            </Button>
          ))}
        </fieldset>
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="size-6" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Search size={32} />
            <p className="text-sm">
              <Trans>No results for your search</Trans>
            </p>
          </div>
        ) : (
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            aria-label="Marketplace catalog"
          >
            {filtered.map((entry) => (
              <li key={entry.id}>
                <MarketplaceCard
                  entry={entry}
                  onInstall={handleInstallFromCard}
                  onCardClick={handleCardClick}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detail drawer */}
      <DetailDrawer
        entry={selectedEntry}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onInstall={handleInstallFromDrawer}
      />

      {/* Import review modal */}
      {selectedEntry && (
        <ImportReviewModal
          bundleJson={installBundleJson}
          open={modalOpen}
          onClose={handleModalClose}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
