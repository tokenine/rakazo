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
 */

const ADDRESS_PROBE_COMMAND = "thaifi fund 2>/dev/null || thaifi whoami";
const ADDRESS_PROBE_TIMEOUT_MS = 15_000;

export async function walletOverview(
  deps: { prisma: PrismaClient; sandbox: SandboxProvider },
  actor: Actor,
): Promise<WalletOverview> {
  const [bots, user] = await Promise.all([
    deps.prisma.bot.findMany({
      where: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        archivedAt: null,
        computer: { isNot: null },
      },
      include: { computer: true },
      orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "asc" }],
    }),
    deps.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { walletAddress: true },
    }),
  ]);

  const agentWallets = await Promise.all(
    bots.map(async (bot) => {
      const base = { botId: bot.id, botName: bot.name };
      const computer = bot.computer;
      const providerRef = computer?.providerRef;
      if (!computer || computer.state !== "running" || !providerRef) {
        return { ...base, state: "unavailable" as const };
      }
      const stdout = await probeWalletAddress(
        deps.sandbox,
        { homeKey: computer.homeKey, kind: computer.kind, providerRef },
        actor,
        bot.id,
      );
      if (stdout === null) return { ...base, state: "unavailable" as const };
      const address = parseThaifiAddress(stdout);
      if (!address) return { ...base, state: "unpaired" as const };
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

  const personalAddress = user?.walletAddress ?? null;
  let personalBalances: WalletOverview["personalBalances"] = [];
  let personalError: string | null = null;
  if (personalAddress) {
    try {
      personalBalances = await fetchThaifiBalances(personalAddress);
    } catch (error) {
      personalError = error instanceof Error ? error.message : "Could not fetch balances";
    }
  }

  return {
    chainId: THAIIFI_CHAIN_ID,
    walletUrl: THAIIFI_WALLET_URL,
    explorerUrl: THAIIFI_EXPLORER_URL,
    agentWallets,
    personalAddress,
    personalBalances,
    personalError,
  };
}

export async function setPersonalWalletAddress(
  deps: { prisma: PrismaClient },
  actor: Actor,
  address: string | null,
): Promise<void> {
  try {
    await deps.prisma.user.update({
      where: { id: actor.userId },
      data: { walletAddress: address },
    });
  } catch {
    throw new ORPCError("NOT_FOUND", { message: "User not found" });
  }
}

/** Returns the probe stdout, or null when the computer could not be reached. */
async function probeWalletAddress(
  sandbox: SandboxProvider,
  computer: { homeKey: string; kind: string; providerRef: string },
  actor: Actor,
  botId: string,
): Promise<string | null> {
  const context: AdapterContext = {
    operationId: `wallet-probe-${botId}`,
    traceId: `wallet-probe-${botId}`,
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId,
    signal: new AbortController().signal,
  };
  try {
    let stdout = "";
    const events = sandbox.execute(
      toComputerRef(computer),
      { argv: ["bash", "-c", ADDRESS_PROBE_COMMAND], timeoutMs: ADDRESS_PROBE_TIMEOUT_MS },
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
