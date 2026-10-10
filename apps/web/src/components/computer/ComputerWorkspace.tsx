import { useLingui } from "@lingui/react/macro";
import type { ComputerStatus } from "@rakazo/contracts";
import { Button, cn } from "@rakazo/ui-web";
import { Folder, Globe, SquareTerminal, X } from "lucide-react";
import type { PointerEvent, ReactNode, RefObject } from "react";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { FilesApp } from "./FilesApp";

// xterm is only needed once someone opens the terminal.
const TerminalApp = lazy(() => import("./TerminalApp"));

type App = "terminal" | "files";
type Position = { x: number; y: number };
type Size = { width: number; height: number };

const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 220;
const DEFAULT_WINDOW_WIDTH = 560;
const DEFAULT_WINDOW_HEIGHT = 420;

/**
 * The computer overlay body: the live screen fills the desktop, and a dock opens the
 * terminal and file browser as movable, resizable windows on top of it. The browser
 * button tucks the windows away (keeping their sessions) to reveal the screen.
 */
export function ComputerWorkspace({
  botId,
  computer,
  hasControl,
  dock,
  onTakeControl,
  children,
}: {
  botId: string;
  computer: ComputerStatus | null;
  hasControl: boolean;
  /** Take control of the screen, resolving false on failure; absent while that is not possible. */
  onTakeControl?: () => Promise<boolean>;
  /** Hidden while teaching so recording captures only the screen. */
  dock: boolean;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const desktop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<App[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [positions, setPositions] = useState<Partial<Record<App, Position>>>({});
  const [sizes, setSizes] = useState<Partial<Record<App, Size>>>({});
  const running = computer?.state === "running";
  const shellAvailable = running && Boolean(computer?.terminalAvailable);
  const hasScreen = computer?.kind !== "desktop";
  const screenVisible = collapsed || open.length === 0;
  const apps: Array<{ id: App; label: string; icon: ReactNode }> = [
    { id: "terminal", label: t`Terminal`, icon: <SquareTerminal /> },
    { id: "files", label: t`Files`, icon: <Folder /> },
  ];

  const toggle = (app: App) => {
    if (collapsed) {
      setCollapsed(false);
      setOpen((current) => [...current.filter((item) => item !== app), app]);
      return;
    }
    setOpen((current) =>
      current.includes(app) ? current.filter((item) => item !== app) : [...current, app],
    );
  };
  const focus = (app: App) =>
    setOpen((current) => [...current.filter((item) => item !== app), app]);
  const move = useCallback(
    (app: App, position: Position) => setPositions((current) => ({ ...current, [app]: position })),
    [],
  );
  const resize = useCallback(
    (app: App, size: Size) => setSizes((current) => ({ ...current, [app]: size })),
    [],
  );

  if (!dock) return <div className="relative h-full min-h-0">{children}</div>;

  return (
    <div ref={desktop} className="relative h-full min-h-0 overflow-hidden">
      {children}
      {apps
        .filter((app) => open.includes(app.id))
        .map((app) => (
          <WorkspaceWindow
            key={app.id}
            title={app.label}
            hidden={collapsed}
            bounds={desktop}
            position={positions[app.id] ?? defaultPosition(app.id, desktop.current)}
            size={sizes[app.id] ?? defaultSize(desktop.current)}
            zIndex={10 + open.indexOf(app.id)}
            onMove={(position) => move(app.id, position)}
            onResize={(size) => resize(app.id, size)}
            onFocus={() => focus(app.id)}
            onClose={() => toggle(app.id)}
          >
            {app.id === "terminal" ? (
              <Suspense fallback={null}>
                <TerminalApp
                  key={botId}
                  botId={botId}
                  canUseShell={shellAvailable && hasControl}
                  onTakeControl={shellAvailable ? onTakeControl : undefined}
                />
              </Suspense>
            ) : (
              <FilesApp
                key={botId}
                botId={botId}
                running={running}
                canUpload={hasControl && running}
                visible={!collapsed}
              />
            )}
          </WorkspaceWindow>
        ))}
      <nav className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 gap-1 rounded-2xl border border-border bg-card/90 p-1.5 shadow-lg backdrop-blur">
        {hasScreen ? (
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t`Browser`}
            aria-pressed={screenVisible}
            className={cn("rounded-xl", screenVisible && "bg-accent")}
            onClick={() => setCollapsed((current) => (open.length ? !current : false))}
          >
            <Globe />
          </Button>
        ) : null}
        {apps.map((app) => (
          <Button
            key={app.id}
            variant="ghost"
            size="icon-lg"
            aria-label={app.label}
            aria-pressed={!collapsed && open.includes(app.id)}
            className={cn("rounded-xl", !collapsed && open.includes(app.id) && "bg-accent")}
            onClick={() => toggle(app.id)}
          >
            {app.icon}
          </Button>
        ))}
      </nav>
    </div>
  );
}

/** Terminal opens on the left and Files on the right so both stay visible. */
function defaultPosition(app: App, desktop: HTMLDivElement | null): Position {
  if (app === "terminal") return { x: 32, y: 24 };
  const width = desktop?.clientWidth ?? 0;
  return { x: Math.max(48, width - DEFAULT_WINDOW_WIDTH - 32), y: 56 };
}

/** The pre-resize size: the classic 560×420 window, clamped to the desktop. */
function defaultSize(desktop: HTMLDivElement | null): Size {
  const width = Math.min(
    DEFAULT_WINDOW_WIDTH,
    (desktop?.clientWidth ?? DEFAULT_WINDOW_WIDTH + 32) - 32,
  );
  const height = Math.min(DEFAULT_WINDOW_HEIGHT, Math.round((desktop?.clientHeight ?? 600) * 0.7));
  return {
    width: Math.max(MIN_WINDOW_WIDTH, width),
    height: Math.max(MIN_WINDOW_HEIGHT, height),
  };
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function WorkspaceWindow({
  title,
  hidden,
  bounds,
  position,
  size,
  zIndex,
  onMove,
  onResize,
  onFocus,
  onClose,
  children,
}: {
  title: string;
  /** Kept mounted while hidden so a terminal session or open folder survives. */
  hidden: boolean;
  bounds: RefObject<HTMLDivElement | null>;
  position: Position;
  size: Size;
  zIndex: number;
  onMove: (position: Position) => void;
  onResize: (size: Size) => void;
  onFocus: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resizing = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y };
  }

  function dragTo(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const area = bounds.current?.getBoundingClientRect();
    const x = event.clientX - drag.current.dx;
    const y = event.clientY - drag.current.dy;
    // Keep the title bar reachable inside the desktop.
    onMove({
      x: area ? Math.min(Math.max(x, -200), area.width - 120) : x,
      y: area ? Math.min(Math.max(y, 0), area.height - 40) : y,
    });
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = {
      x: event.clientX,
      y: event.clientY,
      width: size.width,
      height: size.height,
    };
  }

  function resizeTo(event: PointerEvent<HTMLDivElement>) {
    const start = resizing.current;
    if (!start) return;
    // Keep the right/bottom edge inside the desktop as the window grows.
    const area = bounds.current?.getBoundingClientRect();
    const maxWidth = area ? area.width - position.x : Number.MAX_SAFE_INTEGER;
    const maxHeight = area ? area.height - position.y : Number.MAX_SAFE_INTEGER;
    onResize({
      width: Math.round(
        clampValue(
          start.width + event.clientX - start.x,
          MIN_WINDOW_WIDTH,
          Math.max(MIN_WINDOW_WIDTH, maxWidth),
        ),
      ),
      height: Math.round(
        clampValue(
          start.height + event.clientY - start.y,
          MIN_WINDOW_HEIGHT,
          Math.max(MIN_WINDOW_HEIGHT, maxHeight),
        ),
      ),
    });
  }

  return (
    <section
      aria-label={title}
      hidden={hidden}
      className={cn(
        "absolute flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl",
        hidden ? "hidden" : "flex",
      )}
      style={{ left: position.x, top: position.y, width: size.width, height: size.height, zIndex }}
      onPointerDownCapture={onFocus}
    >
      <div
        className="flex cursor-grab touch-none items-center gap-2 border-b border-border py-1 pr-1 pl-3 select-none active:cursor-grabbing"
        onPointerDown={startDrag}
        onPointerMove={dragTo}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span className="flex-1 truncate text-[13px] font-medium text-foreground">{title}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={t`Close ${title}`}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {[
        "absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize",
        "absolute inset-y-0 right-0 w-1.5 cursor-ew-resize",
        "absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize",
      ].map((className) => (
        <div
          key={className}
          aria-hidden
          className={cn("touch-none", className)}
          onPointerDown={startResize}
          onPointerMove={resizeTo}
          onPointerUp={() => {
            resizing.current = null;
          }}
          onPointerCancel={() => {
            resizing.current = null;
          }}
        />
      ))}
    </section>
  );
}
