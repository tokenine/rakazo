#!/usr/bin/env node
import { writeFileSync } from "node:fs";
/**
 * Browser JS kernel for the `js` tool — ZCode-style: the model's code runs
 * with Playwright locators against the live Chromium on this computer's
 * display, connected over CDP. Invoked per call by rakazo-page-browser:
 *
 *   node rakazo-browser-kernel.mjs <codeFile> <timeoutMs>
 *
 * Prints one JSON object on stdout:
 *   { ok, url, title, text?, imageBase64?, imageMimeType?, error? }
 *
 * The SDK in scope mirrors ZCode's browser-use surface:
 *   const tab = await agent.browsers.tab();
 *   tab.page                 — a Playwright Page (locators, goto, evaluate…)
 *   await tab.domSnapshot()  — accessibility-style tree
 *   await tab.screenshot()   — { imageBase64, imageMimeType }
 *   agent.write(text)        — accumulate output text
 */
import { createRequire } from "node:module";

const [, , codeFile, timeoutArg] = process.argv;
const timeoutMs = Math.min(Math.max(Number(timeoutArg) || 60_000, 1_000), 120_000);

function fail(error) {
  process.stdout.write(
    JSON.stringify({ ok: false, url: "", title: "", error: String(error).slice(0, 4_000) }),
  );
  process.exit(0);
}

function loadPlaywright() {
  const roots = ["/usr/lib/node_modules", "/usr/local/lib/node_modules"];
  for (const root of roots) {
    try {
      const require = createRequire(`${root}/`);
      return require("playwright-core");
    } catch {
      /* try next root */
    }
  }
  throw new Error("playwright-core is not installed in this computer image");
}

function cdpPort() {
  const override = process.env.RAKAZO_CDP_PORT;
  if (override) return Number(override);
  const raw = process.env.DISPLAY || ":1";
  const display = Number.parseInt(String(raw).replace(":", "").split(".")[0] || "1", 10) || 1;
  return 9221 + display;
}

function pickPage(browser) {
  const context = browser.contexts()[0] ?? null;
  const pages = context ? context.pages() : [];
  const usable = pages.filter((page) => !page.url().startsWith("devtools://"));
  return usable.length ? usable[usable.length - 1] : null;
}

const hardStop = setTimeout(() => fail(`js timed out after ${timeoutMs} ms`), timeoutMs);

try {
  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort()}`);
  let page = pickPage(browser);
  if (!page) {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    page = await context.newPage();
  }

  const output = [];
  const agent = {
    write: (value) => {
      output.push(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    },
    browsers: {
      tab: async () => ({
        page,
        url: () => page.url(),
        title: () => page.title(),
        domSnapshot: async () => {
          // ARIA-style outline via the accessibility tree when reachable.
          const snapshot = await page
            .locator("body")
            .ariaSnapshot()
            .catch(() => null);
          if (snapshot) return snapshot;
          return page.evaluate(() => document.body?.innerText?.slice(0, 20_000) ?? "");
        },
        screenshot: async (options = {}) => {
          const buffer = await page.screenshot({ type: "png", ...options });
          return {
            imageBase64: buffer.toString("base64"),
            imageMimeType: "image/png",
          };
        },
      }),
    },
  };

  const { readFileSync } = await import("node:fs");
  const code = readFileSync(codeFile, "utf8");
  const run = new Function("agent", `"use strict";\nreturn (async () => {\n${code}\n})();`);
  const returned = await run(agent);

  let text = output.join("\n");
  if (returned !== undefined && returned !== null) {
    const rendered = typeof returned === "string" ? returned : JSON.stringify(returned, null, 2);
    text = text ? `${text}\n${rendered}` : rendered;
    if (returned && typeof returned === "object" && returned.imageBase64) {
      const url = page.url();
      const title = await page.title().catch(() => "");
      clearTimeout(hardStop);
      process.stdout.write(
        JSON.stringify({
          ok: true,
          url,
          title,
          text: text.slice(0, 400_000),
          imageBase64: String(returned.imageBase64).slice(0, 3_000_000),
          imageMimeType: returned.imageMimeType === "image/jpeg" ? "image/jpeg" : "image/png",
        }),
      );
      process.exit(0);
    }
  }

  clearTimeout(hardStop);
  process.stdout.write(
    JSON.stringify({
      ok: true,
      url: page.url(),
      title: await page.title().catch(() => ""),
      text: text.slice(0, 400_000),
    }),
  );
  process.exit(0);
} catch (error) {
  clearTimeout(hardStop);
  fail(error);
}
