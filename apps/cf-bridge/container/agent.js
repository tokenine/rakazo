#!/usr/bin/env node
// Control agent for rakazo computers running on Cloudflare Containers.
// The bridge Worker proxies exec/file calls here over getTcpPort. Runs as the
// `rakazo` user so processes match what the docker supervisor would spawn.
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HOME = process.env.HOME || "/home/rakazo";
const PORT = Number(process.env.AGENT_PORT || 8090);
const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const MAX_TIMEOUT_MS = 3600_000;

function safePath(raw) {
  const url = new URL(raw, "http://localhost");
  const requested = url.searchParams.get("path") ?? "";
  const resolved = path.resolve(requested);
  if (resolved !== HOME && !resolved.startsWith(`${HOME}/`)) return null;
  return resolved;
}

function execScript(script, timeoutMs) {
  return new Promise((resolve) => {
    const clamped = Math.max(1000, Math.min(MAX_TIMEOUT_MS, Number(timeoutMs) || 60_000));
    const seconds = Math.ceil(clamped / 1000);
    const child = spawn(
      "timeout",
      ["-k", "5", String(seconds), "bash", "-c", script],
      { cwd: HOME, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const capped = (limit) => {
      let size = 0;
      return (chunk) => {
        size += chunk.length;
        return size <= limit;
      };
    };
    const keepOut = capped(MAX_STREAM_BYTES);
    const keepErr = capped(MAX_STREAM_BYTES);
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => {
      if (keepOut(chunk)) out.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (keepErr(chunk)) err.push(chunk);
    });
    child.on("error", (error) => {
      resolve({ code: 127, stdout: "", stderr: String(error) });
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 124,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

function readBody(request, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/ping") {
      const mounted = fs
        .readFileSync("/proc/mounts", "utf8")
        .includes(` ${HOME} fuse`);
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ ok: true, homeMounted: mounted }));
    }

    if (url.pathname === "/debug") {
      const read = (file, limit = 5000) => {
        try {
          return fs.readFileSync(file, "utf8").slice(-limit);
        } catch (error) {
          return `(${error.code})`;
        }
      };
      response.writeHead(200, { "content-type": "text/plain" });
      return response.end(
        [
          "== /proc/mounts (fuse/home lines) ==",
          read("/proc/mounts")
            .split("\n")
            .filter((line) => line.includes("fuse") || line.includes(HOME))
            .join("\n") || "(none)",
          "== /var/log/rakazo/startup.log ==",
          read("/var/log/rakazo/startup.log"),
          "== /var/log/rakazo/tigrisfs.log ==",
          read("/var/log/rakazo/tigrisfs.log"),
          "== /var/log/rakazo/agent.log ==",
          read("/var/log/rakazo/agent.log", 2000),
        ].join("\n"),
      );
    }

    if (url.pathname === "/exec" && request.method === "POST") {
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      const result = await execScript(String(body.script ?? ""), Number(body.timeoutMs));
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify(result));
    }

    if (url.pathname === "/files/read" && request.method === "GET") {
      const target = safePath(request.url ?? "/");
      if (!target) {
        response.writeHead(403);
        return response.end("path outside home");
      }
      const content = fs.readFileSync(target);
      response.writeHead(200, { "content-type": "application/octet-stream" });
      return response.end(content);
    }

    if (url.pathname === "/files/write" && request.method === "PUT") {
      const target = safePath(request.url ?? "/");
      if (!target) {
        response.writeHead(403);
        return response.end("path outside home");
      }
      const body = await readBody(request);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ ok: true }));
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  } catch (error) {
    const code = error?.message === "body too large" ? 413 : 500;
    response.writeHead(code, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: String(error?.message ?? error) }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[agent] listening on ${PORT} (home: ${HOME})`);
});
