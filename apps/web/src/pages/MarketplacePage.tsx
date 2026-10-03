import { Trans } from "@lingui/react/macro";
import type { CatalogEntry } from "@rakazo/contracts";
import {
  BotAvatar,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
} from "@rakazo/ui-web";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { rpc } from "../lib/rpc";

const KIND_FILTERS = ["agent", "skill", "mcp"] as const;
type KindFilter = (typeof KIND_FILTERS)[number] | "all";

const PROVENANCE_LABELS: Record<string, string> = {
  bundled: "Bundled",
  operator: "Operator",
  registry: "Registry",
};

function ProvenanceBadge({ provenance }: { provenance: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-foreground/20 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {PROVENANCE_LABELS[provenance] ?? provenance}
    </span>
  );
}

function MarketplaceCard({
  entry,
  onInstall,
}: {
  entry: CatalogEntry;
  onInstall: (entry: CatalogEntry) => void;
}) {
  return (
    <Card
      className="group/card relative flex flex-col"
      data-testid={`marketplace-card-${entry.id}`}
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
          <ProvenanceBadge provenance={entry.provenance} />
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

export function MarketplacePage() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<KindFilter>("all");

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

  function handleInstall(entry: CatalogEntry) {
    // T8 wires the detail drawer + import review modal.
    // For now, emit a custom event the T8 handler can catch.
    window.dispatchEvent(
      new CustomEvent("marketplace:install", { detail: { entry }, bubbles: true }),
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Header: search + kind chips */}
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
                <MarketplaceCard entry={entry} onInstall={handleInstall} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
