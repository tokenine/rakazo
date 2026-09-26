import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tsc only emits the TypeScript sources; the preload bridges, the setup
// window's static assets, and raw .mjs sources under client-browser have to
// be copied into dist alongside them.
const STATIC_FILES = ["preload.cjs", "setup-preload.cjs", "setup.html", "setup.css", "setup.js"];
const TOKENS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ui-tokens/src/tokens.css",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await mkdir(dist, { recursive: true });
const clientBrowserDir = path.join(root, "src", "client-browser");
const clientBrowserMjs = (await readdir(clientBrowserDir)).filter((file) => file.endsWith(".mjs"));
await Promise.all([
  ...STATIC_FILES.map((file) => copyFile(path.join(root, "src", file), path.join(dist, file))),
  copyFile(TOKENS_FILE, path.join(dist, "tokens.css")),
  mkdir(path.join(dist, "client-browser"), { recursive: true }),
  ...clientBrowserMjs.map((file) =>
    copyFile(path.join(clientBrowserDir, file), path.join(dist, "client-browser", file)),
  ),
]);
