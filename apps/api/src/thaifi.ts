import type { ThaifiTokenBalance } from "@rakazo/contracts";

/**
 * ThaiFi chain (chain ID 17, Tempo-compatible) read-only balance lookups.
 * Balances are public chain state: no key material ever reaches the server —
 * only the account address is needed to call `balanceOf` on the TIP-20 tokens.
 */

const THAIIFI_RPC_URL = process.env.THAIIFI_RPC_URL ?? "https://rpc.thaifi.com";

const THAIIFI_TOKENS = [
  { symbol: "pathUSD", address: "0x20c0000000000000000000000000000000000000", decimals: 6 },
  { symbol: "THCFI", address: "0x20c000000000000000000000c82102FFe7064362", decimals: 6 },
  { symbol: "THCOC", address: "0x20C0000000000000000000007c24a0c628e8A940", decimals: 6 },
] as const;

const BALANCE_OF_SELECTOR = "0x70a08231";
const BALANCE_CACHE_TTL_MS = 30_000;
const RPC_TIMEOUT_MS = 10_000;

/** Unanchored: CLI output embeds the address inside labeled lines. */
const ADDRESS_IN_TEXT = /0x[0-9a-fA-F]{40}/;

const balanceCache = new Map<string, { at: number; balances: ThaifiTokenBalance[] }>();

/** First 0x…40-hex address in the output (`Account:` precedes `Agent key:` in `thaifi whoami`). */
export function parseThaifiAddress(output: string): string | null {
  const match = ADDRESS_IN_TEXT.exec(output);
  return match ? match[0] : null;
}

export function formatTokenUnits(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toString();
  const fracText = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracText}`;
}

export async function fetchThaifiBalances(
  address: string,
  signal?: AbortSignal,
): Promise<ThaifiTokenBalance[]> {
  const cached = balanceCache.get(address.toLowerCase());
  if (cached && Date.now() - cached.at < BALANCE_CACHE_TTL_MS) return cached.balances;

  const timeout = AbortSignal.timeout(RPC_TIMEOUT_MS);
  const responses = await fetch(THAIIFI_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      THAIIFI_TOKENS.map((token, index) => ({
        jsonrpc: "2.0",
        id: index,
        method: "eth_call",
        params: [{ to: token.address, data: `${BALANCE_OF_SELECTOR}${toWord(address)}` }, "latest"],
      })),
    ),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }).then((response) => {
    if (!response.ok) throw new Error(`ThaiFi RPC returned ${response.status}`);
    return response.json() as Promise<Array<{ result?: string; error?: { message?: string } }>>;
  });

  const balances = THAIIFI_TOKENS.map((token, index) => {
    const entry = responses[index];
    if (!entry?.result) {
      throw new Error(entry?.error?.message ?? `ThaiFi RPC missing result for ${token.symbol}`);
    }
    return {
      symbol: token.symbol,
      address: token.address,
      formatted: formatTokenUnits(BigInt(entry.result), token.decimals),
    };
  });
  balanceCache.set(address.toLowerCase(), { at: Date.now(), balances });
  return balances;
}

function toWord(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}
