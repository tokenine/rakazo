import { Trans, useLingui } from "@lingui/react/macro";
import { Button, cn } from "@rakazo/ui-web";
import { ChevronLeft, File, Folder, GitBranch, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CodingSessionTerminal } from "../components/computer/TerminalApp";
import {
  embeddableScreenUrl,
  loadComputerScreen,
  screenIframeSandbox,
} from "../lib/computer-screen";
import { rpc } from "../lib/rpc";
import { AcceptanceCard } from "./shell/acceptance-card";

type PanelId = "terminal" | "files" | "git";

interface FileEntry {
  path: string;
  kind: "file" | "dir";
  size: number;
  executable?: boolean;
}

interface GitCommit {
  sha: string;
  parents: string[];
  subject: string;
  author: string;
  date: string;
}

interface GitGraph {
  commits: GitCommit[];
  refs: string[];
  dirty: number;
  notRepo: boolean;
}

const MAX_FILES_RENDERED = 200;
const MAX_COMMITS_RENDERED = 50;

/**
 * The code workspace (004 R12): the session's computer screen as the main
 * area, Terminal/Files/Git as side panels that only appear when the session
 * has content for them, and the acceptance card in the rail.
 */
export function CodeWorkspacePage() {
  const { t } = useLingui();
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const [bot, setBot] = useState<{ id: string; name: string } | null>(null);
  const [panel, setPanel] = useState<PanelId>("terminal");
  const [terminal, setTerminal] = useState<{ viewOnly: boolean } | null>(null);
  const [rootFiles, setRootFiles] = useState<FileEntry[] | null>(null);
  const [git, setGit] = useState<GitGraph | null>(null);
  const [screenUrl, setScreenUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The workspace RPCs are keyed by session id; the bot is resolved only to
    // name the header and embed the computer screen.
    void (async () => {
      try {
        for (const bot of await rpc.bots.list()) {
          const sessions = await rpc.codingSessions.list({ botId: bot.id });
          if (sessions.some((session) => session.id === sessionId)) {
            if (!cancelled) setBot({ id: bot.id, name: bot.name });
            return;
          }
        }
      } catch {
        // Without the bot the panels still work; only the screen embed waits.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Availability is re-checked every time the Terminal panel is opened: the
  // answer depends on the computer running and the control lease, both of
  // which change while the user is here.
  const refreshTerminal = useCallback(() => {
    rpc.codingSessions
      .terminalUrl({ sessionId })
      .then(({ url }) => setTerminal(url ? { viewOnly: isViewOnlyUrl(url) } : null))
      .catch(() => setTerminal(null));
  }, [sessionId]);

  useEffect(() => {
    refreshTerminal();
  }, [refreshTerminal]);

  useEffect(() => {
    let cancelled = false;
    rpc.codingSessions
      .listFiles({ sessionId, path: "/" })
      .then((entries) => {
        if (!cancelled) setRootFiles(entries);
      })
      .catch(() => {
        if (!cancelled) setRootFiles([]);
      });
    rpc.codingSessions
      .gitGraph({ sessionId })
      .then((graph) => {
        if (!cancelled) setGit(graph);
      })
      .catch(() => {
        if (!cancelled) setGit({ commits: [], refs: [], dirty: 0, notRepo: true });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!bot) return;
    let cancelled = false;
    void loadComputerScreen({
      load: () => rpc.computer.screenUrl({ botId: bot.id }),
      isCurrent: () => !cancelled,
      commit: (result) => {
        if (!cancelled) setScreenUrl(embeddableScreenUrl(result.url));
      },
      fallbackError: t`Could not connect to the computer screen`,
    });
    return () => {
      cancelled = true;
    };
  }, [bot, t]);

  const panels: Array<{ id: PanelId; label: string; icon: typeof Folder; available: boolean }> = [
    { id: "terminal", label: t`Terminal`, icon: SquareTerminal, available: true },
    { id: "files", label: t`Files`, icon: Folder, available: (rootFiles?.length ?? 0) > 0 },
    {
      id: "git",
      label: t`Git`,
      icon: GitBranch,
      // A not-a-repo answer still has content: the truthful empty state.
      available: git !== null,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-1.5 gap-1.5 text-[13.5px] text-foreground"
          aria-label={bot ? t`Back to ${bot.name}` : t`Back`}
          onClick={() => navigate(bot ? `/app/${bot.id}` : "/app")}
        >
          <ChevronLeft size={16} strokeWidth={1.8} aria-hidden="true" />
          <span className="max-w-56 truncate" dir="auto">
            {bot?.name ?? <Trans>Space</Trans>}
          </span>
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-e border-border p-2.5">
          <nav aria-label={t`Panels`} className="flex flex-col gap-0.5">
            {panels.map(({ id, label, icon: Icon, available }) => (
              <button
                key={id}
                type="button"
                data-testid={`panel-${id}`}
                aria-pressed={panel === id}
                disabled={!available}
                onClick={() => {
                  if (id === "terminal") refreshTerminal();
                  setPanel(id);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]",
                  panel === id && available
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  !available && "opacity-50",
                )}
              >
                <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>
          <AcceptanceCard sessionId={sessionId} />
        </aside>
        {panel === "terminal" ? (
          <section
            aria-label={t`Terminal`}
            className="flex w-[26rem] min-w-72 shrink-0 flex-col overflow-hidden border-e border-border"
          >
            {terminal ? (
              <CodingSessionTerminal sessionId={sessionId} hidden={false} interactive={!terminal.viewOnly} />
            ) : (
              <p className="grid h-full place-items-center px-4 text-center text-sm text-muted-foreground">
                <Trans>Terminal needs the computer running and your control.</Trans>
              </p>
            )}
          </section>
        ) : panel === "files" && rootFiles ? (
          <FilesPanel sessionId={sessionId} rootEntries={rootFiles} />
        ) : panel === "git" && git ? (
          <GitPanel graph={git} />
        ) : null}
        <main className="relative min-h-0 min-w-0 flex-1">
          {screenUrl ? (
            <iframe
              title={t`Bot screen`}
              src={screenUrl}
              sandbox={screenIframeSandbox(screenUrl)}
              className="h-full w-full border-0 bg-black"
              allow="clipboard-read; clipboard-write"
              style={{ pointerEvents: "none" }}
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground/60" />
          )}
        </main>
      </div>
    </div>
  );
}

function isViewOnlyUrl(url: string): boolean {
  try {
    return new URL(url, window.location.href).searchParams.get("view_only") === "true";
  } catch {
    return false;
  }
}

/** Lazy file tree: directories expand on demand, files open a read-only preview. */
function FilesPanel({
  sessionId,
  rootEntries,
}: {
  sessionId: string;
  rootEntries: FileEntry[];
}) {
  const { t } = useLingui();
  const [loadedDirs, setLoadedDirs] = useState<Map<string, FileEntry[]>>(new Map());
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);

  const toggleDir = (path: string) => {
    setOpenDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (loadedDirs.has(path)) return;
    rpc.codingSessions
      .listFiles({ sessionId, path })
      .then((entries) => setLoadedDirs((current) => new Map(current).set(path, entries)))
      .catch(() => setLoadedDirs((current) => new Map(current).set(path, [])));
  };

  const openFile = (path: string) => {
    rpc.codingSessions
      .readFile({ sessionId, path })
      .then((file) => setPreview({ path: file.path, content: file.content }))
      .catch(() => setPreview(null));
  };

  if (preview) {
    return (
      <section
        aria-label={preview.path}
        className="flex w-[26rem] min-w-72 shrink-0 flex-col overflow-hidden border-e border-border"
      >
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t`Back to files`}
            onClick={() => setPreview(null)}
          >
            <ChevronLeft size={14} strokeWidth={1.8} aria-hidden="true" />
          </Button>
          <span className="truncate font-mono text-[12px] text-foreground">{preview.path}</span>
        </div>
        <pre
          data-testid="file-preview"
          className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-foreground"
        >
          <code>{preview.content}</code>
        </pre>
      </section>
    );
  }

  const renderEntries = (entries: FileEntry[], depth: number) => (
    <>
      {entries.slice(0, MAX_FILES_RENDERED).map((entry) => {
        const name = entryName(entry.path);
        const open = openDirs.has(entry.path);
        return (
          <div key={entry.path}>
            <button
              type="button"
              data-testid={`file-entry-${name}`}
              aria-expanded={entry.kind === "dir" ? open : undefined}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[12.5px] text-foreground/85 hover:bg-accent hover:text-foreground"
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
              onClick={() => (entry.kind === "dir" ? toggleDir(entry.path) : openFile(entry.path))}
            >
              {entry.kind === "dir" ? (
                <Folder size={13} strokeWidth={1.7} aria-hidden="true" />
              ) : (
                <File size={13} strokeWidth={1.7} aria-hidden="true" />
              )}
              <span className="truncate" dir="auto">
                {name}
              </span>
            </button>
            {entry.kind === "dir" && open
              ? renderEntries(loadedDirs.get(entry.path) ?? [], depth + 1)
              : null}
          </div>
        );
      })}
    </>
  );

  return (
    <section
      aria-label={t`Files`}
      className="flex w-[26rem] min-w-72 shrink-0 flex-col overflow-hidden border-e border-border"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rootEntries.length === 0 ? (
          <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">
            <Trans>No files yet.</Trans>
          </p>
        ) : (
          renderEntries(rootEntries, 0)
        )}
      </div>
    </section>
  );
}

/** Vertical commit graph: rail with dots, monospace sha, subject, relative date. */
function GitPanel({ graph }: { graph: GitGraph }) {
  const { t } = useLingui();
  if (graph.notRepo) {
    return (
      <section
        aria-label={t`Git`}
        className="flex w-[26rem] min-w-72 shrink-0 flex-col overflow-hidden border-e border-border"
      >
        <p className="p-3 text-[12.5px] text-muted-foreground" data-testid="git-empty">
          <Trans>Not a git repository.</Trans>
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label={t`Git`}
      data-testid="git-graph"
      className="flex w-[26rem] min-w-72 shrink-0 flex-col overflow-hidden border-e border-border"
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
        <GitBranch size={13} strokeWidth={1.7} aria-hidden="true" className="text-muted-foreground" />
        <span className="truncate text-[12px] text-muted-foreground">
          {graph.refs.join(" · ")}
        </span>
        {graph.dirty > 0 ? (
          <span
            className="ml-auto rounded-full bg-accent px-1.5 py-0 text-[10.5px] text-muted-foreground tabular-nums"
            data-testid="git-dirty"
          >
            {graph.dirty} <Trans>uncommitted</Trans>
          </span>
        ) : null}
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {graph.commits.slice(0, MAX_COMMITS_RENDERED).map((commit) => (
          <li key={commit.sha} className="group/commit relative flex gap-2.5 pb-3 pl-1 last:pb-0">
            <span
              aria-hidden="true"
              className="absolute top-1.5 bottom-0 left-[3.5px] w-px bg-border group-last/commit:hidden"
            />
            <span
              aria-hidden="true"
              className="mt-1.5 size-2 shrink-0 rounded-full border border-foreground/50 bg-background"
            />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] text-foreground" dir="auto">
                {commit.subject}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {commit.sha.slice(0, 7)} · {relativeDate(commit.date)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function entryName(path: string): string {
  const withoutTrailing = path.replace(/\/+$/, "");
  const index = withoutTrailing.lastIndexOf("/");
  return index === -1 ? withoutTrailing : withoutTrailing.slice(index + 1);
}

function relativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "<1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
