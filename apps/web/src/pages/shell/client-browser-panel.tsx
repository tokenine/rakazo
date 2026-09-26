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
 * Client built-in browser pane (desktop app only): a user-visible <webview>
 * with its own persistent session (imported Chrome logins live here) that the
 * agent can also drive via the client_js tool.
 */
export function ClientBrowserPanel() {
  const { t } = useLingui();
  const webviewRef = useRef<{
    getURL(): string;
    loadURL(url: string): Promise<void>;
    goBack(): void;
    goForward(): void;
    reload(): void;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  } | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const onDidNavigate = () => {
      setAddressInput(webview.getURL());
      setLoading(false);
    };
    const onStarted = () => setLoading(true);
    const onFailed = () => setLoading(false);
    webview.addEventListener("did-navigate", onDidNavigate);
    webview.addEventListener("did-navigate-in-page", onDidNavigate);
    webview.addEventListener("did-start-loading", onStarted);
    webview.addEventListener("did-stop-loading", onDidNavigate);
    webview.addEventListener("did-fail-load", onFailed);
    return () => {
      webview.removeEventListener("did-navigate", onDidNavigate);
      webview.removeEventListener("did-navigate-in-page", onDidNavigate);
      webview.removeEventListener("did-start-loading", onStarted);
      webview.removeEventListener("did-stop-loading", onDidNavigate);
      webview.removeEventListener("did-fail-load", onFailed);
    };
  }, []);

  function navigate(input: string) {
    const webview = webviewRef.current;
    if (!webview || !input.trim()) return;
    const raw = input.trim();
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setError(null);
    webview.loadURL(url).catch(() => setError(t`Could not load that address.`));
  }

  async function importChrome() {
    const bridge = desktopBridge();
    if (!bridge?.clientBrowser || importing) return;
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      setImportResult(await bridge.clientBrowser.importChrome());
    } catch {
      setError(t`Chrome import failed. Chrome may be running — try quitting it first.`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div data-testid="client-browser-panel" className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Back`}
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Forward`}
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRight size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Reload`}
          onClick={() => webviewRef.current?.reload()}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
        </Button>
        <Input
          value={addressInput}
          onChange={(event) => setAddressInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate(addressInput);
          }}
          placeholder={t`Search or enter address`}
          className="h-8 flex-1 rounded-full text-[13px]"
        />
        <Button
          variant="secondary"
          className="rounded-full"
          disabled={importing}
          onClick={() => void importChrome()}
        >
          {importing ? <Trans>Importing…</Trans> : <Trans>Import Chrome</Trans>}
        </Button>
      </div>
      {error ? <p className="px-3 pb-1 text-[12.5px] text-destructive">{error}</p> : null}
      {importResult ? (
        <p
          className="px-3 pb-1 text-[12.5px] text-muted-foreground"
          data-testid="chrome-import-result"
        >
          <Trans>
            Imported {importResult.cookies.imported} cookies,{" "}
            {importResult.localStorage.entriesImported} localStorage entries.
          </Trans>
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <webview
          ref={webviewRef as never}
          partition="persist:aidex-client-browser"
          allowpopups={"true" as never}
          src="https://www.google.com"
          className="h-full w-full border-t border-border"
        />
      </div>
    </div>
  );
}
