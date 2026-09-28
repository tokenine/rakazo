import { timingSafeEqual } from "node:crypto";
import type { ClientRequest, IncomingMessage } from "node:http";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { lingui } from "@lingui/vite-plugin";
import type { DesktopStackProbeResponse } from "@rakazo/contracts";
import {
  safeScreenProxyResponseHeaders,
  stripSensitiveHandshakeHeaders,
} from "@rakazo/core/node/screen-proxy-response";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { PreviewServer, ViteDevServer } from "vite";
import { defineConfig, loadEnv } from "vite";
import { resolveScreenProxySecret } from "../../packages/core/src/secrets-guard.ts";
import { collectNovncHtml, MAX_NOVNC_HTML_BYTES } from "./src/novnc-html.js";
import {
  resolveNovncTarget,
  safeProxyHeaders,
  watchScreenAuthorization,
} from "./src/screen-proxy.js";

const webPort = Number(process.env.WEB_PORT ?? 5173);
const DESKTOP_STACK_PROBE_PATH = "/.well-known/rakazo-desktop-stack";
const DESKTOP_STACK_TOKEN_HEADER = "x-rakazo-desktop-stack-token";

function equalStackToken(expected: string, supplied: string | string[] | undefined) {
  if (expected === "" || typeof supplied !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.byteLength === suppliedBytes.byteLength &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function attachDesktopStackProbe(
  server: ViteDevServer | PreviewServer,
  token: string,
  imageTag: string,
) {
  server.middlewares.use((req, res, next) => {
    if (req.url?.split("?", 1)[0] !== DESKTOP_STACK_PROBE_PATH) {
      next();
      return;
    }
    if (!equalStackToken(token, req.headers[DESKTOP_STACK_TOKEN_HEADER])) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const body: DesktopStackProbeResponse = { ok: true, imageTag };
    res.statusCode = 200;
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  });
}

function attachNovncProxy(
  server: ViteDevServer | PreviewServer,
  secret: string,
  api: string,
  bridge?: { host: string; token: string },
) {
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/novnc/")) {
      next();
      return;
    }
    const target = await resolveNovncTarget(req.url, secret, api);
    if (res.destroyed) return;
    if (!target) {
      res.statusCode = 403;
      res.end("Invalid or expired screen capability");
      return;
    }
    // The storage shim must string-edit the HTML, so compressed responses
    // (bridge/workers.dev compress) need identity encoding — same as CreateOS.
    const isBridgeTarget = Boolean(bridge && target.hostname.toLowerCase() === bridge.host);
    const headers = {
      ...safeProxyHeaders(req.headers),
      ...(isCreateOSNovncHost(target.hostname) || isBridgeTarget
        ? { "accept-encoding": "identity" }
        : {}),
      host: `${target.hostname}:${target.port}`,
      // The CF bridge authenticates every route with a bearer token; other
      // screen targets (e2b, createos, supervisor) are tokenless.
      ...(isBridgeTarget && bridge ? { authorization: `Bearer ${bridge.token}` } : {}),
    };
    const transport = target.protocol === "https:" ? https : http;
    let upstream: ClientRequest | undefined;
    let retries = 0;
    let retryPending = false;
    let stopChecking: () => void = () => undefined;
    const retryable = req.method === "GET";
    const scheduleRetry = (incoming?: IncomingMessage) => {
      if (!retryable || retryPending || retries >= 3 || res.destroyed) return false;
      retryPending = true;
      retries += 1;
      const delayMs = 50 * retries;
      const retry = () => {
        setTimeout(() => {
          retryPending = false;
          if (!res.destroyed) requestUpstream();
        }, delayMs);
      };
      if (incoming && !incoming.destroyed) {
        incoming.once("close", retry);
        incoming.destroy();
      } else {
        retry();
      }
      return true;
    };
    let downstreamFinished = false;
    const finishUnavailable = () => {
      if (downstreamFinished || res.destroyed || res.writableEnded) return;
      downstreamFinished = true;
      stopChecking();
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.statusCode = 502;
      res.end("Screen unavailable");
    };
    function requestUpstream() {
      if (res.destroyed) return;
      upstream = transport.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.path,
          method: req.method,
          headers,
          ...(target.protocol === "https:" ? { servername: target.hostname } : {}),
        },
        (incoming) => {
          if ((incoming.statusCode ?? 502) >= 500 && scheduleRetry(incoming)) {
            return;
          }
          const responseHeaders = safeScreenProxyResponseHeaders(incoming.headers);
          if (shouldInjectNovncStorageShim(responseHeaders, target.hostname, isBridgeTarget ? [bridge.host] : [])) {
            const declaredLength = Number(incoming.headers["content-length"] ?? 0);
            if (Number.isFinite(declaredLength) && declaredLength > MAX_NOVNC_HTML_BYTES) {
              finishUnavailable();
              incoming.destroy();
              return;
            }
            void collectNovncHtml(incoming, MAX_NOVNC_HTML_BYTES)
              .then((html) => {
                if (downstreamFinished || res.destroyed || res.writableEnded) return;
                downstreamFinished = true;
                const body = injectNovncStorageShim(html);
                delete responseHeaders["content-length"];
                res.writeHead(incoming.statusCode ?? 502, responseHeaders);
                res.end(body);
              })
              .catch(() => {
                finishUnavailable();
              });
            return;
          }
          res.writeHead(incoming.statusCode ?? 502, responseHeaders);
          incoming.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (
          retryable &&
          !downstreamFinished &&
          !res.headersSent &&
          !res.destroyed &&
          (retryPending || scheduleRetry())
        ) {
          return;
        }
        finishUnavailable();
      });
      if (req.method === "GET" || req.readableEnded) upstream.end();
      else req.pipe(upstream);
    }
    stopChecking = watchScreenAuthorization(
      async () => Boolean(await resolveNovncTarget(req.url, secret, api)),
      () => {
        upstream?.destroy();
        res.destroy();
      },
    );
    res.once("close", () => {
      stopChecking();
      upstream?.destroy();
    });
    requestUpstream();
  });

  server.httpServer?.on("upgrade", async (req, socket, head) => {
    if (!req.url?.startsWith("/novnc/")) return;
    console.error(`[novnc-ws] upgrade req.url=${req.url.slice(0, 200)}`);
    const target = await resolveNovncTarget(req.url, secret, api);
    if (socket.destroyed) return;
    if (!target) {
      console.error(`[novnc-ws] upgrade resolve FAILED for ${req.url.slice(0, 120)}`);
      socket.destroy();
      return;
    }
    const upstream =
      target.protocol === "https:"
        ? tls.connect({ port: target.port, host: target.hostname, servername: target.hostname })
        : net.connect(target.port, target.hostname);
    const stopChecking = watchScreenAuthorization(
      async () => Boolean(await resolveNovncTarget(req.url, secret, api)),
      () => {
        socket.destroy();
        upstream.destroy();
      },
    );
    socket.once("close", () => {
      stopChecking();
      upstream.destroy();
    });
    upstream.once("close", () => {
      stopChecking();
      socket.destroy();
    });
    upstream.once(target.protocol === "https:" ? "secureConnect" : "connect", () => {
      const headerLines = [
        `${req.method ?? "GET"} ${target.path} HTTP/1.1`,
        `Host: ${target.hostname}:${target.port}`,
      ];
      for (const [key, value] of Object.entries(safeProxyHeaders(req.headers))) {
        headerLines.push(`${key}: ${Array.isArray(value) ? value.join(",") : value}`);
      }
      if (bridge && target.hostname.toLowerCase() === bridge.host && bridge.token) {
        headerLines.push(`authorization: Bearer ${bridge.token}`);
      }
      console.error(`[novnc-ws] upgrade target host=${target.hostname} path=${target.path.slice(0, 140)}`);
      upstream.write(`${headerLines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      const responseChunks: Buffer[] = [];
      let responseSize = 0;
      let responseTail = Buffer.alloc(0);
      const forwardHandshake = (chunk: Buffer) => {
        responseChunks.push(chunk);
        responseSize += chunk.length;
        if (responseSize > 64 * 1024) {
          console.error(`[novnc-ws] handshake oversized for ${target.hostname}`);
          socket.destroy();
          upstream.destroy();
          return;
        }
        const boundarySearch = Buffer.concat([responseTail, chunk]);
        if (boundarySearch.indexOf("\r\n\r\n") < 0) {
          responseTail = Buffer.from(boundarySearch.subarray(-3));
          return;
        }
        const responseHead = Buffer.concat(responseChunks, responseSize);
        console.error(`[novnc-ws] upstream handshake: ${responseHead.toString("latin1").split("\r\n")[0]}`);
        const safe = stripSensitiveHandshakeHeaders(responseHead);
        if (!safe) {
          socket.destroy();
          upstream.destroy();
          return;
        }
        upstream.off("data", forwardHandshake);
        socket.write(safe);
        upstream.pipe(socket);
      };
      upstream.on("data", forwardHandshake);
      upstream.on("error", (err) => console.error(`[novnc-ws] upstream error: ${err.message}`));
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
}

const NOVNC_STORAGE_SHIM_HOSTS = [".app.sb.createos.sh"];

function isCreateOSNovncHost(hostname: string) {
  return NOVNC_STORAGE_SHIM_HOSTS.some((suffix) => hostname.endsWith(suffix));
}

function shouldInjectNovncStorageShim(
  headers: http.IncomingHttpHeaders,
  hostname: string,
  extraHostSuffixes: string[] = [],
) {
  if (!isCreateOSNovncHost(hostname) && !extraHostSuffixes.some((s) => hostname.endsWith(s)))
    return false;
  if (headers["content-encoding"]) return false;
  const contentType = String(headers["content-type"] ?? "").toLowerCase();
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

function injectNovncStorageShim(html: string) {
  const shim = `<script>
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
    clear() {},
  },
});
// Browser extensions (MetaMask, wallets, …) inject content scripts into this
// frame too; on a sandboxed opaque-origin document they always fail to reach
// their extension context and the thrown error would surface as a scary red
// noVNC error box. Swallow only extension-origin errors — real noVNC errors
// come from our own origin and still show.
window.addEventListener("error", (e) => {
  const source = e.filename || "";
  if (source.startsWith("chrome-extension:") || source.startsWith("moz-extension:")) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true);
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  const text = String((reason && (reason.stack || reason.message)) || reason || "");
  if (text.includes("chrome-extension:") || text.includes("moz-extension:")) {
    e.preventDefault();
  }
});
</script>`;
  return html.includes("<head>")
    ? html.replace("<head>", `<head>${shim}`)
    : html.replace(/<script\b/i, `${shim}<script`);
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(import.meta.dirname, "../.."), "");
  const api = process.env.API_PROXY_TARGET ?? rootEnv.API_PROXY_TARGET ?? "http://127.0.0.1:3100";
  const previewHost = process.env.RAKAZO_HOST ?? rootEnv.RAKAZO_HOST ?? "localhost";
  const screenProxySecret = () =>
    resolveScreenProxySecret({
      ...process.env,
      SCREEN_PROXY_SECRET: process.env.SCREEN_PROXY_SECRET ?? rootEnv.SCREEN_PROXY_SECRET,
      SANDBOX_SUPERVISOR_TOKEN:
        process.env.SANDBOX_SUPERVISOR_TOKEN ?? rootEnv.SANDBOX_SUPERVISOR_TOKEN,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? rootEnv.BETTER_AUTH_SECRET,
    });
  const performanceAssetDelayMs = Number(process.env.RAKAZO_PERFORMANCE_ASSET_DELAY_MS ?? 0);
  const desktopStackToken =
    process.env.RAKAZO_DESKTOP_STACK_TOKEN ?? rootEnv.RAKAZO_DESKTOP_STACK_TOKEN ?? "";
  const imageTag = process.env.RAKAZO_IMAGE_TAG ?? rootEnv.RAKAZO_IMAGE_TAG ?? "edge";
  const cfBridgeUrl = process.env.CF_BRIDGE_URL ?? rootEnv.CF_BRIDGE_URL ?? "";
  const cfBridgeToken = process.env.CF_BRIDGE_TOKEN ?? rootEnv.CF_BRIDGE_TOKEN ?? "";
  const cfBridge =
    cfBridgeUrl.trim() && cfBridgeToken.trim()
      ? { host: new URL(cfBridgeUrl).hostname.toLowerCase(), token: cfBridgeToken.trim() }
      : undefined;
  return {
    plugins: [
      react(),
      babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
      lingui(),
      tailwindcss(),
      {
        name: "rakazo-desktop-stack-probe",
        configureServer: (server) => attachDesktopStackProbe(server, desktopStackToken, imageTag),
        configurePreviewServer: (server) =>
          attachDesktopStackProbe(server, desktopStackToken, imageTag),
      },
      {
        name: "rakazo-performance-asset-delay",
        configurePreviewServer(server) {
          if (!Number.isFinite(performanceAssetDelayMs) || performanceAssetDelayMs <= 0) return;
          server.middlewares.use((req, _res, next) => {
            const pathname = req.url?.split("?", 1)[0] ?? "/";
            if (["/api", "/rpc", "/novnc"].some((prefix) => pathname.startsWith(prefix))) {
              next();
              return;
            }
            setTimeout(next, performanceAssetDelayMs);
          });
        },
      },
      {
        name: "rakazo-novnc-proxy",
        configureServer: (server) => attachNovncProxy(server, screenProxySecret(), api, cfBridge),
        configurePreviewServer: (server) =>
          attachNovncProxy(server, screenProxySecret(), api, cfBridge),
      },
    ],
    server: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: {
        "/api": { target: api, changeOrigin: true },
        "/rpc": { target: api, changeOrigin: true },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: Number(process.env.WEB_PORT ?? 5173),
      allowedHosts: previewHost.split(/[,\s]+/).filter(Boolean),
      proxy: {
        "/api": { target: api, changeOrigin: true },
        "/rpc": { target: api, changeOrigin: true },
      },
    },
  };
});
