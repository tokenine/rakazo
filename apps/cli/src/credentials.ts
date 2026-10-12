/**
 * The one credential store for the CLI: <config-dir>/credentials.json, 0600.
 * Env vars (RAKAZO_TOKEN, RAKAZO_BASE_URL, RAKAZO_SPACE_ID) override it —
 * nothing else configures the CLI.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  server: string;
  token: string;
  spaceId: string;
}

export interface CredentialsOptions {
  configDir?: string;
}

function credentialsPath(opts?: CredentialsOptions): string {
  const dir =
    opts?.configDir ?? process.env.RAKAZO_CONFIG_DIR ?? join(homedir(), ".config", "rakazo");
  return join(dir, "credentials.json");
}

export function storeCredentials(creds: Credentials, opts?: CredentialsOptions): void {
  const path = credentialsPath(opts);
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
}

export function loadCredentials(opts?: CredentialsOptions): Credentials | null {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(opts), "utf8")) as Partial<Credentials>;
    if (
      typeof parsed.server !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.spaceId !== "string"
    ) {
      return null;
    }
    return { server: parsed.server, token: parsed.token, spaceId: parsed.spaceId };
  } catch {
    return null;
  }
}

export function removeCredentials(opts?: CredentialsOptions): void {
  rmSync(credentialsPath(opts), { force: true });
}
