import { ORPCError } from "@orpc/server";
import type { AdapterContext, SandboxProvider } from "@rakazo/adapter-kit";
import { toComputerRef } from "@rakazo/adapters";
import type { Actor, WalletOverview } from "@rakazo/contracts";
import { THAIIFI_CHAIN_ID, THAIIFI_EXPLORER_URL, THAIIFI_WALLET_URL } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { fetchThaifiBalances, parseThaifiAddress } from "./thaifi.js";

/**
 * Wallet settings data: each bot's agent wallet is read from its own computer
 * (`thaifi` CLI is baked into every computer image; the paired key lives only
 * there), while balances are always fetched server-side from the public
 * ThaiFi RPC so computer egress restrictions cannot break the panel.
 * Pairing is started the same way the bots themselves do it: a detached
 * `thaifi login --no-browser` whose stdout lands in a temp file we read back.
 */

const PROBE_COMMAND =
  "thaifi fund 2>/dev/null; printf '\\n---WHOAMI---\\n'; thaifi whoami 2>/dev/null; true";
const PROBE_TIMEOUT_MS = 15_000;

/** Same recipe the bots use (see the thaifi-wallet expertise): detached login,
 * URL captured to a file we can read; approval completes the background process. */
const PAIR_COMMAND =
  "nohup thaifi login --no-browser > /tmp/rakazo-thaifi-pair.txt 2>&1 & sleep 3; cat /tmp/rakazo-thaifi-pair.txt 2>/dev/null; true";
const PAIR_TIMEOUT_MS = 25_000;
const PAIRING_URL_PATTERN = /https:\/\/wallet\.thaifi\.com\/pair\?[^\s"']+/;
const KEY_EXPIRES_PATTERN = /Key expires:\s*(\S+)/;

export async function walletOverview(
  deps: { prisma: PrismaClient; sandbox: SandboxProvider },
  actor: Actor,
): Promise<WalletOverview> {
  const bots = await deps.prisma.bot.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      archivedAt: null,
      computer: { isNot: null },
    },
    include: { computer: true },
    orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "asc" }],
  });

  const agentWallets = await Promise.all(
    bots.map(async (bot) => {
      const base = { botId: bot.id, botName: bot.name };
      const computer = bot.computer;
      const providerRef = computer?.providerRef;
      if (!computer || computer.state !== "running" || !providerRef) {
        return { ...base, state: "unavailable" as const };
      }
      const stdout = await execOnComputer(
        deps.sandbox,
        { homeKey: computer.homeKey, kind: computer.kind, providerRef },
        actor,
        bot.id,
        PROBE_COMMAND,
        PROBE_TIMEOUT_MS,
      );
      if (stdout === null) return { ...base, state: "unavailable" as const };
      const address = parseThaifiAddress(stdout);
      if (!address) return { ...base, state: "unpaired" as const };
      const expiresText = KEY_EXPIRES_PATTERN.exec(stdout)?.[1];
      const expiresAt = expiresText ? Date.parse(expiresText) : NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        return { ...base, state: "expired" as const, address };
      }
      try {
        const balances = await fetchThaifiBalances(address);
        return { ...base, state: "ready" as const, address, balances, error: null };
      } catch (error) {
        return {
          ...base,
          state: "ready" as const,
          address,
          balances: [],
          error: error instanceof Error ? error.message : "Could not fetch balances",
        };
      }
    }),
  );

  return {
    chainId: THAIIFI_CHAIN_ID,
    walletUrl: THAIIFI_WALLET_URL,
    explorerUrl: THAIIFI_EXPLORER_URL,
    agentWallets,
  };
}

/**
 * Starts the pairing flow on the bot's computer and returns the approval URL
 * printed by `thaifi login --no-browser` (null when none appeared in time —
 * the background process keeps running and the user can retry or pair later).
 */
export async function startWalletPairing(
  deps: { prisma: PrismaClient; sandbox: SandboxProvider },
  actor: Actor,
  botId: string,
): Promise<{ pairingUrl: string | null }> {
  const bot = await deps.prisma.bot.findFirst({
    where: { id: botId, spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
    include: { computer: true },
  });
  if (!bot?.computer) throw new ORPCError("NOT_FOUND", { message: "Bot not found" });
  const computer = bot.computer;
  const providerRef = computer.providerRef;
  if (computer.state !== "running" || !providerRef) {
    throw new ORPCError("CONFLICT", {
      message: "The bot's computer is not running. Start it first, then pair the wallet.",
    });
  }
  const stdout = await execOnComputer(
    deps.sandbox,
    { homeKey: computer.homeKey, kind: computer.kind, providerRef },
    actor,
    bot.id,
    PAIR_COMMAND,
    PAIR_TIMEOUT_MS,
  );
  if (stdout === null) {
    throw new ORPCError("CONFLICT", { message: "Could not reach the bot's computer." });
  }
  const match = PAIRING_URL_PATTERN.exec(stdout);
  return { pairingUrl: match ? match[0] : null };
}

/** Returns the command stdout, or null when the computer could not be reached. */
async function execOnComputer(
  sandbox: SandboxProvider,
  computer: { homeKey: string; kind: string; providerRef: string },
  actor: Actor,
  botId: string,
  command: string,
  timeoutMs: number,
): Promise<string | null> {
  const context: AdapterContext = {
    operationId: `wallet-${botId}`,
    traceId: `wallet-${botId}`,
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId,
    signal: new AbortController().signal,
  };
  try {
    let stdout = "";
    const events = sandbox.execute(
      toComputerRef(computer),
      { argv: ["bash", "-c", command], timeoutMs },
      context,
    );
    for await (const event of events) {
      if (event.type === "stdout") stdout += event.data;
    }
    return stdout;
  } catch {
    return null;
  }
}
