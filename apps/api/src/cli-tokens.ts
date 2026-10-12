/**
 * CLI tokens (007-cli-auth-handshake): scoped, revocable credentials for the
 * Rakazo CLI. Raw tokens exist only at issuance and in the user's CLI store;
 * the server persists the SHA-256 hash and resolves tokens through the same
 * actor path as browser sessions. No expiry by default — revocation-only.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { requireMembership } from "@rakazo/db";

export const CLI_TOKEN_PREFIX = "rakazo_cli_";

export function hashCliToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface MintedCliToken {
  id: string;
  name: string;
  /** Shown once at issuance; never stored or logged. */
  token: string;
}

export async function mintCliToken(
  prisma: PrismaClient,
  input: { userId: string; name: string },
): Promise<MintedCliToken> {
  const token = CLI_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const row = await prisma.cliToken.create({
    data: { userId: input.userId, name: input.name, tokenHash: hashCliToken(token) },
  });
  return { id: row.id, name: row.name, token };
}

/** Resolve a raw CLI token to its owner's actor; null for unknown/revoked/empty. */
export async function actorForCliToken(prisma: PrismaClient, raw: string): Promise<Actor | null> {
  if (!raw.trim()) return null;
  const row = await prisma.cliToken.findUnique({
    where: { tokenHash: hashCliToken(raw) },
  });
  if (!row || row.revokedAt) return null;
  try {
    const actor = await requireMembership(prisma, row.userId);
    void prisma.cliToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return actor;
  } catch {
    return null;
  }
}

export async function revokeCliToken(
  prisma: PrismaClient,
  input: { id: string; userId: string },
): Promise<{ ok: true }> {
  await prisma.cliToken.updateMany({
    where: { id: input.id, userId: input.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { ok: true };
}
