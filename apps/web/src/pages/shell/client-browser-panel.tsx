import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@rakazo/ui-web";
import { ArrowLeft, ArrowRight, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../../lib/desktop";

type ImportResult = NonNullable<ReturnType<typeof desktopBridge>>["clientBrowser"] extends infer C
  ? C extends { importChrome: () => Promise<infer R> }
    ? R
    : never
  : never;

/**
 * Client built-in browser pane (desktop app only). The visible content is a
 * main-process WebContentsView laid over this component's placeholder — the
 * placeholder reports its window-space rect on mount/resize and must stretch
 * to the bottom of the window (full height). Navigation chrome talks to the
 * main process over IPC; URL/loading state is pushed back on the same channel.
 */
export function ClientBrowserPanel() {
  const { t } = useLingui();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = desktopBridge()?.clientBrowser;
    if (!bridge?.onState) return;
    const off = bridge.onState((state) => {
      setAddressInput(state.url);
      setLoading(state.loading);
    });
    void bridge.state?.().then((state) => {
      setAddressInput(state.url);
      setLoading(state.loading);
    });
    return off;
  }, []);

  useEffect(() => {
    const bridge = desktopBridge()?.clientBrowser;
    const host = hostRef.current;
    if (!bridge?.show || !host) return;
    const report = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      void bridge.show({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(host);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      void bridge.hide?.();
    };
  }, []);

  function navigate(input: string) {
    const bridge = desktopBridge()?.clientBrowser;
    const raw = input.trim();
    if (!bridge?.navigate || !raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setError(null);
    void bridge.navigate(url).catch(() => setError(t`Could not load that address.`));
  }

  async function importChrome() {
    const bridge = desktopBridge()?.clientBrowser;
    if (!bridge?.importChrome || importing) return;
    setImporting(true);
    setError(null);
    try {
      setImportResult(await bridge.importChrome());
    } catch {
      setError(t`Import failed — check that Chrome is installed.`);
    } finally {
      setImporting(false);
    }
  }

  function action(verb: "back" | "forward" | "reload") {
    void desktopBridge()?.clientBrowser?.action?.(verb);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-2 pt-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Back`}
          onClick={() => action("back")}
          className="h-8 w-8 shrink-0"
        >
          <ArrowLeft size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Forward`}
          onClick={() => action("forward")}
          className="h-8 w-8 shrink-0"
        >
          <ArrowRight size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Reload`}
          onClick={() => action("reload")}
          className="h-8 w-8 shrink-0"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />}
        </Button>
        <Input
          value={addressInput}
          placeholder={t`Search or type a URL`}
          onChange={(event) => setAddressInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate(addressInput);
          }}
          className="h-8 min-w-0 flex-1 rounded-full text-[13px]"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void importChrome()}
          disabled={importing}
          className="shrink-0 rounded-full"
        >
          {importing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Trans>Import Chrome</Trans>
          )}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="px-3 pt-2 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
      {importResult ? (
        <p className="px-3 pt-2 text-[12.5px] text-muted-foreground">
          {importResult.success ? (
            <Trans>
              Imported {importResult.cookies.imported} cookies ·{" "}
              {importResult.localStorage.originsImported} sites of local storage.
            </Trans>
          ) : (
            (importResult.error ?? t`Import failed — check that Chrome is installed.`)
          )}
        </p>
      ) : null}
      {/*
        The native WebContentsView is laid exactly over this placeholder by
        the main process. min-h-0 + flex-1 make it reach the window bottom.
      */}
      <div ref={hostRef} className="min-h-0 flex-1" data-testid="client-browser-host" />
    </div>
  );
}
