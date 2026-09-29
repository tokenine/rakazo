import * as z from "zod";
import { Id } from "./ids.js";

export const THAIIFI_CHAIN_ID = 17;
export const THAIIFI_WALLET_URL = "https://wallet.thaifi.com";
export const THAIIFI_EXPLORER_URL = "https://exp.thaifi.com";
export const THAIIFI_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const ThaifiTokenBalanceSchema = z.object({
  symbol: z.string(),
  address: z.string(),
  formatted: z.string(),
});
export type ThaifiTokenBalance = z.infer<typeof ThaifiTokenBalanceSchema>;

/**
 * One bot's agent wallet. "unpaired" = no key in the bot's home yet;
 * "expired" = a key exists but its on-chain access expired (re-pair to fix);
 * "unavailable" = the bot's computer is not running (nothing probed).
 */
export const AgentWalletEntrySchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ready"),
    botId: Id,
    botName: z.string(),
    address: z.string(),
    balances: z.array(ThaifiTokenBalanceSchema),
    error: z.string().nullable(),
  }),
  z.object({
    state: z.literal("unpaired"),
    botId: Id,
    botName: z.string(),
  }),
  z.object({
    state: z.literal("expired"),
    botId: Id,
    botName: z.string(),
    address: z.string(),
  }),
  z.object({
    state: z.literal("unavailable"),
    botId: Id,
    botName: z.string(),
  }),
]);
export type AgentWalletEntry = z.infer<typeof AgentWalletEntrySchema>;

export const WalletOverviewSchema = z.object({
  chainId: z.literal(THAIIFI_CHAIN_ID),
  walletUrl: z.string(),
  explorerUrl: z.string(),
  agentWallets: z.array(AgentWalletEntrySchema),
});
export type WalletOverview = z.infer<typeof WalletOverviewSchema>;

/** Result of starting `thaifi login --no-browser` on a bot's computer. */
export const WalletPairingSchema = z.object({
  /** Approve URL at wallet.thaifi.com, or null when the CLI printed none. */
  pairingUrl: z.string().nullable(),
});
export type WalletPairing = z.infer<typeof WalletPairingSchema>;
