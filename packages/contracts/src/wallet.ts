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

/** One bot's agent wallet: ready (paired), unpaired (no key in its home), or unavailable (computer not reachable). */
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
  personalAddress: z.string().nullable(),
  personalBalances: z.array(ThaifiTokenBalanceSchema),
  personalError: z.string().nullable(),
});
export type WalletOverview = z.infer<typeof WalletOverviewSchema>;
