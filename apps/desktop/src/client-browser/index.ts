/**
 * Client built-in browser (Ai7 desktop): a user-visible Browser pane the
 * agent can also drive. Two capabilities live here:
 *  1. Chrome data import (ported from ZCode's browserDataManager family) into
 *     the persistent partition below — cookies + localStorage, macOS keychain.
 *  2. The `client_js` kernel: playwright-core connects over the app's own
 *     remote-debugging port and hands model code a real Page (locators) bound
 *     to the pane's WebContentsView.
 *
 * The pane's content itself is a main-process WebContentsView (see pane.ts):
 * its CDP target is a full "page" the kernel can attach to.
 */

import { createRequire } from "node:module";
import { app, type BrowserWindow, ipcMain } from "electron";
import { clearEmbeddedBrowserData, importChromeBrowserData } from "./browserDataManager.js";
import { logger } from "./logger-shim.js";
import { actionPane, hidePane, navigatePane, showPane, statePane } from "./pane.js";

export { CLIENT_BROWSER_PARTITION } from "./pane.js";

let cdpPort: number | null = null;
let appOrigin = "";

/** The bundled renderer's origin — used to tell app tabs from browsing tabs. */
export function setClientBrowserAppOrigin(origin: string): void {
  appOrigin = origin.replace(/\/+$/, "");
}

/** Must run before app `ready` — registers the private CDP port. */
export function setupClientBrowserCdp(): void {
  cdpPort = 9223 + Math.floor(Math.random() * 400);
  app.commandLine.appendSwitch("remote-debugging-port", String(cdpPort));
  app.commandLine.appendSwitch("remote-allow-origins", "http://127.0.0.1");
}

export function registerClientBrowserIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("desktop.clientBrowser.importChrome", async () => {
    const result = await importChromeBrowserData({ logger, platform: process.platform });
    logger.info("[client-browser] chrome import finished", { success: result.success });
    return result;
  });
  ipcMain.handle("desktop.clientBrowser.clearData", async (_event, options: { mode?: string }) => {
    return clearEmbeddedBrowserData({
      logger,
      mode: options?.mode === "all" ? "all" : "cache",
    });
  });
  ipcMain.handle(
    "desktop.clientBrowser.runJs",
    async (_event, payload: { code: string; timeoutMs?: number; targetUrl?: string }) => {
      return runClientBrowserJs(payload);
    },
  );
  ipcMain.handle(
    "desktop.clientBrowser.show",
    (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      const window = getWindow();
      if (!window) return;
      showPane(window, bounds);
    },
  );
  ipcMain.handle("desktop.clientBrowser.hide", () => {
    hidePane();
  });
  ipcMain.handle("desktop.clientBrowser.navigate", (_event, payload: { url: string }) => {
    navigatePane(payload.url);
  });
  ipcMain.handle("desktop.clientBrowser.action", (_event, payload: { verb: string }) => {
    actionPane(payload.verb as "back" | "forward" | "reload");
  });
  ipcMain.handle("desktop.clientBrowser.state", () => {
    return statePane();
  });
}

type KernelResult = {
  ok: boolean;
  url: string;
  title: string;
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  error?: string;
};

function loadPlaywright(): typeof import("playwright-core") {
  const require = createRequire(import.meta.url);
  return require("playwright-core");
}

/** Run model-authored JS against the pane's webview via playwright over CDP. */
export async function runClientBrowserJs(payload: {
  code: string;
  timeoutMs?: number;
  targetUrl?: string;
}): Promise<KernelResult> {
  if (cdpPort === null) throw new Error("client browser CDP is not initialized");
  const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || 60_000, 1_000), 120_000);
  const hardStop = setTimeout(() => {
    throw new Error(`client_js timed out after ${timeoutMs} ms`);
  }, timeoutMs + 5_000);
  try {
    const { chromium } = loadPlaywright();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const pages = browser
      .contexts()
      .flatMap((context: { pages(): unknown[] }) => context.pages()) as Array<
      import("playwright-core").Page
    >;
    const eligible = pages.filter((page) => {
      const url = page.url();
      if (url.startsWith("devtools://")) return false;
      if (payload.targetUrl) return url === payload.targetUrl;
      return appOrigin ? !url.startsWith(appOrigin) : true;
    });
    // Prefer a real page; a freshly opened pane sits at about:blank and is still
    // the user's tab — attaching is fine (page.goto navigates it).
    const real = eligible.filter((page) => page.url() !== "about:blank");
    const page = real[real.length - 1] ?? eligible[eligible.length - 1] ?? null;
    if (!page) {
      return {
        ok: false,
        url: "",
        title: "",
        error:
          "No client browser tab is open. Ask the user to open the Browser pane (Globe icon in the desktop app), then retry — a freshly opened blank pane is fine, just page.goto the target.",
      };
    }

    const output: string[] = [];
    const tab = {
      page,
      url: () => page.url(),
      title: () => page.title(),
      domSnapshot: async () =>
        (await page
          .locator("body")
          .ariaSnapshot()
          .catch(() => null)) ??
        (await page.evaluate(() => document.body?.innerText?.slice(0, 20_000) ?? "")),
      screenshot: async (options: { fullPage?: boolean } = {}) => {
        const buffer = await page.screenshot({ type: "png", ...options });
        return { imageBase64: buffer.toString("base64"), imageMimeType: "image/png" };
      },
    };
    const agent = {
      write: (value: unknown) => {
        output.push(typeof value === "string" ? value : JSON.stringify(value, null, 2));
      },
      browsers: {
        tab: async () => tab,
      },
    };

    // `tab` is pre-bound in the code's scope — models routinely write
    // `await tab.page.goto(...)` without calling agent.browsers.tab() first.
    const run = new Function(
      "agent",
      "tab",
      `"use strict";\nreturn (async () => {\n${payload.code}\n})();`,
    );
    const returned = await run(agent, tab);
    let text = output.join("\n");
    if (returned !== undefined && returned !== null) {
      const rendered = typeof returned === "string" ? returned : JSON.stringify(returned, null, 2);
      text = text ? `${text}\n${rendered}` : rendered;
      if (returned && typeof returned === "object" && returned.imageBase64) {
        clearTimeout(hardStop);
        return {
          ok: true,
          url: page.url(),
          title: await page.title().catch(() => ""),
          text: text.slice(0, 400_000),
          imageBase64: String(returned.imageBase64).slice(0, 3_000_000),
          imageMimeType: returned.imageMimeType === "image/jpeg" ? "image/jpeg" : "image/png",
        };
      }
    }
    clearTimeout(hardStop);
    return {
      ok: true,
      url: page.url(),
      title: await page.title().catch(() => ""),
      text: text.slice(0, 400_000),
    };
  } catch (error) {
    clearTimeout(hardStop);
    return {
      ok: false,
      url: "",
      title: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
