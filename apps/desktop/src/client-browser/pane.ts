/**
 * The Browser pane's native content: a WebContentsView owned by the main
 * process and overlaid on the renderer's placeholder rect. A <webview> tag
 * would be simpler to lay out, but its guest CDP target reports type
 * "webview", which Playwright (and Electron's CDP server, which lacks
 * Target.createTarget) can never turn into a Page — the agent kernel would
 * be unable to drive it. A WebContentsView's webContents is a normal
 * "page" target with the full Playwright surface.
 */
import { type BrowserWindow, WebContentsView } from "electron";

export const CLIENT_BROWSER_PARTITION = "persist:aidex-client-browser";

export type ClientBrowserPaneState = { url: string; loading: boolean };

let view: WebContentsView | null = null;
let hostWindow: BrowserWindow | null = null;

function reportState(): void {
  if (!view || !hostWindow || hostWindow.isDestroyed()) return;
  const wc = view.webContents;
  if (wc.isDestroyed()) return;
  hostWindow.webContents.send("desktop.clientBrowser.state", {
    url: wc.getURL(),
    loading: wc.isLoading(),
  } satisfies ClientBrowserPaneState);
}

function ensureView(): WebContentsView {
  if (view && !view.webContents.isDestroyed()) return view;
  view = new WebContentsView({
    webPreferences: {
      partition: CLIENT_BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const wc = view.webContents;
  wc.on("did-navigate", () => reportState());
  wc.on("did-navigate-in-page", () => reportState());
  wc.on("did-start-loading", () => reportState());
  wc.on("did-stop-loading", () => reportState());
  // Force links that ask for a new window into this view — the user never
  // loses the page and the agent keeps a single stable target.
  wc.setWindowOpenHandler(({ url }) => {
    void wc.loadURL(url);
    return { action: "deny" };
  });
  void wc.loadURL("https://www.google.com");
  return view;
}

export function showPane(
  window: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  hostWindow = window;
  const v = ensureView();
  const content = window.contentView;
  if (!content.children.includes(v)) content.addChildView(v);
  v.setBounds(bounds);
  reportState();
}

export function hidePane(): void {
  if (view && hostWindow && !hostWindow.isDestroyed()) {
    hostWindow.contentView.removeChildView(view);
  }
  hostWindow = null;
}

export function navigatePane(url: string): void {
  if (!view || view.webContents.isDestroyed()) return;
  void view.webContents.loadURL(url);
}

export function actionPane(verb: "back" | "forward" | "reload"): void {
  if (!view || view.webContents.isDestroyed()) return;
  const wc = view.webContents;
  if (verb === "back") wc.goBack();
  else if (verb === "forward") wc.goForward();
  else wc.reload();
}

export function statePane(): ClientBrowserPaneState {
  if (!view || view.webContents.isDestroyed()) return { url: "", loading: false };
  return { url: view.webContents.getURL(), loading: view.webContents.isLoading() };
}
