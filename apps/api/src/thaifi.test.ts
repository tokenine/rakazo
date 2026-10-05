import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchThaifiBalances, formatTokenUnits, parseThaifiAddress } from "./thaifi.js";

describe("parseThaifiAddress", () => {
  it("takes the first address (Account) from `thaifi whoami` output", () => {
    const whoami = [
      "Account:     0xf4430e750965d110174ff484c1586fdb9d56e7ff",
      "Agent key:   0xbD84067F173cEa68A1a015Fe2fD7A1Ce77E77cc9",
      "pathUSD: $0",
      "THCFI:   4.498625",
    ].join("\n");
    expect(parseThaifiAddress(whoami)).toBe("0xf4430e750965d110174ff484c1586fdb9d56e7ff");
  });

  it("reads the deposit address from `thaifi fund` output", () => {
    const fund = "Deposit address (your wallet):\n  0xf4430e750965d110174ff484c1586fdb9d56e7ff\n";
    expect(parseThaifiAddress(fund)).toBe("0xf4430e750965d110174ff484c1586fdb9d56e7ff");
  });

  it("returns null for unpaired output", () => {
    expect(parseThaifiAddress("No paired agent key found. Run `thaifi login` first.")).toBeNull();
  });
});

describe("formatTokenUnits", () => {
  it("formats 6-decimal token amounts without float error", () => {
    expect(formatTokenUnits(4498625n, 6)).toBe("4.498625");
    expect(formatTokenUnits(0n, 6)).toBe("0");
    expect(formatTokenUnits(1_000_000n, 6)).toBe("1");
    expect(formatTokenUnits(1_500_000n, 6)).toBe("1.5");
  });
});

describe("fetchThaifiBalances", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes batched balanceOf results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { jsonrpc: "2.0", id: 0, result: `0x${1_234_567n.toString(16).padStart(64, "0")}` },
          { jsonrpc: "2.0", id: 1, result: `0x${4_498_625n.toString(16).padStart(64, "0")}` },
          { jsonrpc: "2.0", id: 2, result: `0x${0n.toString(16).padStart(64, "0")}` },
        ]),
      ),
    );
    const balances = await fetchThaifiBalances("0xf4430e750965d110174ff484c1586fdb9d56e7ff");
    expect(balances.map((entry) => [entry.symbol, entry.formatted])).toEqual([
      ["pathUSD", "1.234567"],
      ["THCFI", "4.498625"],
      ["THCOC", "0"],
    ]);
  });

  it("throws when the RPC answers with an error entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { jsonrpc: "2.0", id: 0, error: { message: "execution reverted" } },
          { jsonrpc: "2.0", id: 1, result: "0x0" },
          { jsonrpc: "2.0", id: 2, result: "0x0" },
        ]),
      ),
    );
    await expect(fetchThaifiBalances("0x00000000000000000000000000000000000000ff")).rejects.toThrow(
      "execution reverted",
    );
  });
});
