/**
 * The CLI half of browser login (007): listen once on loopback, wait for the
 * authorize page to deliver the token (or a denial). The state nonce binds
 * the delivery to this exact login attempt; mismatched states are rejected.
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";

export type CallbackResult = { token: string } | { denied: true } | { timeout: true };

export function waitForCliCallback(input: {
  state: string;
  timeoutMs: number;
  onListening: (port: number) => void;
}): Promise<CallbackResult> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        let body: { state?: string; token?: string; denied?: boolean } = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof body;
        } catch {
          res.statusCode = 400;
          res.end();
          return;
        }
        if (body.state !== input.state) {
          res.statusCode = 403;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.end("ok");
        server.close();
        if (body.denied) resolve({ denied: true });
        else if (body.token) resolve({ token: body.token });
        else resolve({ timeout: true });
      });
    });
    server.on("error", () => resolve({ timeout: true }));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      input.onListening(port);
      setTimeout(() => {
        server.close();
        resolve({ timeout: true });
      }, input.timeoutMs).unref();
    });
  });
}

/** Open the authorize URL in the user's browser; never throws. */
export function openBrowser(url: string, platform: string = process.platform): void {
  const command = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Headless or unsupported platform: the URL is printed instead.
  }
}
