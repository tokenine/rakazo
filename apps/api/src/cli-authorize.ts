/**
 * CLI authorization (007-cli-auth-handshake): the server half of
 * `rakazo login`. The CLI opens GET /cli/authorize with a one-time state
 * nonce; the session-authed page lets the user Allow or Deny; on Allow the
 * page claims the freshly minted token (shown once) and delivers it to the
 * CLI's loopback listener. Raw tokens are never stored or logged.
 */

import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { mintCliToken, revokeCliToken } from "./cli-tokens.js";
import type { RouterDeps } from "./router.js";

type AuthedDeps = { actor: Actor; prisma: PrismaClient };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** RPC: settings list of the caller's CLI tokens (including revoked, for audit). */
export async function cliTokensList(deps: RouterDeps & { actor: Actor }) {
  const rows = await deps.prisma.cliToken.findMany({
    where: { userId: deps.actor.userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }));
}

/** RPC: revoke one of the caller's tokens; takes effect on the next request. */
export async function cliTokensRevoke(deps: RouterDeps & { actor: Actor }, input: { id: string }) {
  return revokeCliToken(deps.prisma, { id: input.id, userId: deps.actor.userId });
}

/**
 * The Allow action: mint a token for the sessioned user. The response carries
 * the raw token exactly once — the page forwards it to the CLI's loopback
 * listener (or displays it for headless paste).
 */
export function claimCliToken(
  deps: { actor: Actor | null; prisma: PrismaClient },
  input: { name: string },
): Promise<Response> {
  if (!deps.actor) return Promise.resolve(json({ error: "UNAUTHORIZED" }, 401));
  const name = input.name.trim().slice(0, 80) || "CLI";
  return mintCliToken(deps.prisma, {
    userId: deps.actor.userId,
    name,
  }).then((minted) => json({ token: minted.token, id: minted.id, name: minted.name }));
}

function authorizePage(input: {
  state: string;
  port: string;
  name: string;
  signedIn: boolean;
}): Response {
  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const state = esc(input.state);
  const port = Number.isFinite(Number(input.port)) ? Number(input.port) : 0;
  const name = esc(input.name);
  const body = input.signedIn
    ? `<h1>Authorize “${name}”?</h1>
<p>Allow <b>${name}</b> to control Rakazo with its own token? You can revoke it anytime in Settings.</p>
<p>No expiry — revocation only.</p>
<button id="allow">Allow</button> <button id="deny">Deny</button>
<pre id="out"></pre>
<script>
const state = ${JSON.stringify(input.state)};
const port = ${port};
const out = document.getElementById("out");
document.getElementById("allow").onclick = async () => {
  const res = await fetch("/cli/authorize/claim", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ name: ${JSON.stringify(input.name)} }) });
  if (!res.ok) { out.textContent = "Not signed in — open this page in your Rakazo browser session."; return; }
  const body = await res.json();
  try {
    const deliver = await fetch("http://127.0.0.1:" + port + "/callback", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ state, token: body.token }) });
    out.textContent = deliver.ok ? "Authorized — you can close this page." : "Could not reach the CLI listener. Paste this token into the CLI:\\n" + body.token;
  } catch { out.textContent = "Could not reach the CLI listener. Paste this token into the CLI:\\n" + body.token; }
};
document.getElementById("deny").onclick = async () => {
  try { await fetch("http://127.0.0.1:" + port + "/callback", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ state, denied: true }) }); } catch {}
  out.textContent = "Denied — nothing was issued.";
};
</script>`
    : `<h1>Sign in first</h1><p>Open this page in a browser where you are signed in to Rakazo, then retry <b>rakazo login</b>.</p>`;
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Rakazo CLI authorization</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:48px auto">${body}</body></html>`,
    { status: input.signedIn ? 200 : 401, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * Mount GET /cli/authorize (the approval page) and POST /cli/authorize/claim
 * (the Allow action). `actorFor` resolves the page session (or null).
 */
export function mountCliAuthorize(
  app: {
    get: (path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>) => void;
    post: (path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>) => void;
  },
  deps: { prisma: PrismaClient; actorFor: (request: Request) => Promise<Actor | null> },
): void {
  app.get("/cli/authorize", async (c) => {
    const url = new URL(c.req.raw.url);
    const actor = await deps.actorFor(c.req.raw);
    return authorizePage({
      state: url.searchParams.get("state") ?? "",
      port: url.searchParams.get("port") ?? "",
      name: url.searchParams.get("name") ?? "CLI",
      signedIn: actor !== null,
    });
  });
  app.post("/cli/authorize/claim", async (c) => {
    const actor = await deps.actorFor(c.req.raw);
    let name = "CLI";
    try {
      const body = (await c.req.raw.json()) as { name?: string };
      if (typeof body.name === "string") name = body.name;
    } catch {
      // Empty body is fine; the name falls back to "CLI".
    }
    return claimCliToken({ actor, prisma: deps.prisma }, { name });
  });
}

export { claimCliToken as cliAuthorizeClaim };
