// T6 RED — catalog seam tests
// Tests the CatalogSource interface, bundled/operator providers, and marketplace.list RPC.

import type { CatalogSource } from "@rakazo/contracts";
import {
  BUNDLED_CATALOG,
  createMarketplaceCatalog,
  createOperatorCatalogSource,
} from "@rakazo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_KINDS = ["agent", "skill", "mcp"] as const;

describe("bundled provider", () => {
  it("returns entries without requiring any network", async () => {
    const entries = await BUNDLED_CATALOG.list();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every entry has required UI fields", async () => {
    const entries = await BUNDLED_CATALOG.list();
    for (const entry of entries) {
      expect(entry, "id").toHaveProperty("id");
      expect(entry, "name").toHaveProperty("name");
      expect(entry, "title").toHaveProperty("title");
      expect(entry, "description").toHaveProperty("description");
      expect(entry, "kind").toHaveProperty("kind");
      expect(entry, "provenance").toHaveProperty("provenance");
      expect(entry, "avatarKey").toHaveProperty("avatarKey");
      expect(entry.provenance).toBe("bundled");
    }
  });

  it("every entry has a valid kind chip value", async () => {
    const entries = await BUNDLED_CATALOG.list();
    for (const entry of entries) {
      expect(VALID_KINDS).toContain(entry.kind);
    }
  });
});

describe("operator URL provider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects non-HTTPS URLs", () => {
    expect(() => createOperatorCatalogSource("http://example.com/catalog.json")).toThrow(/https/i);
  });

  it("rejects invalid URL patterns", () => {
    expect(() => createOperatorCatalogSource("not-a-url")).toThrow();
    expect(() => createOperatorCatalogSource("")).toThrow();
  });

  it("returns entries from a valid HTTPS operator URL", async () => {
    const source = createOperatorCatalogSource(
      "https://operator.example.com/marketplace-catalog.json",
    );
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        entries: [
          {
            id: "op-1",
            name: "Operator Agent",
            title: "Operator Agent",
            description: "An agent from the operator",
            kind: "agent",
            provenance: "operator",
            avatarKey: null,
          },
        ],
      }),
    });

    const entries = await source.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("op-1");
    expect(entries[0].provenance).toBe("operator");
  });

  it("network failure yields an inconclusive skipped item (not an error)", async () => {
    const source = createOperatorCatalogSource(
      "https://operator.example.com/marketplace-catalog.json",
    );
    fetchMock.mockRejectedValue(new Error("Network error"));

    const result = await source.list();
    expect(result).toMatchObject({
      id: "https://operator.example.com/marketplace-catalog.json",
      inconclusive: true,
    });
    if ("reason" in result && typeof result.reason === "string") {
      expect(result.reason).toContain("Network error");
    } else {
      expect.fail("expected SkippedCatalogEntry with reason field");
    }
  });

  it("non-200 response yields an inconclusive skipped item", async () => {
    const source = createOperatorCatalogSource(
      "https://operator.example.com/marketplace-catalog.json",
    );
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const result = await source.list();
    expect(result).toMatchObject({ inconclusive: true });
    if ("reason" in result && typeof result.reason === "string") {
      expect(result.reason).toContain("404");
    } else {
      expect.fail("expected SkippedCatalogEntry with reason field");
    }
  });

  it("invalid payload shape yields an inconclusive skipped item", async () => {
    const source = createOperatorCatalogSource(
      "https://operator.example.com/marketplace-catalog.json",
    );
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ entries: "not-an-array" }),
    });

    const result = await source.list();
    expect(result).toMatchObject({ inconclusive: true });
  });
});

describe("catalog merge: failed source never blocks bundled results", () => {
  it("bundled entries are returned even when operator source fails", async () => {
    const failingSource: CatalogSource = {
      id: "fail",
      list: async () => ({
        id: "fail",
        inconclusive: true,
        reason: "always fails",
      }),
    };

    // Pass failing source ALONGSIDE bundled — bundled must still appear.
    const catalog = createMarketplaceCatalog([BUNDLED_CATALOG, failingSource]);
    const result = await catalog.list();

    // Bundled entries must be present regardless of the failing source.
    const bundled = result.filter((e) => e.provenance === "bundled");
    expect(bundled.length).toBeGreaterThan(0);
  });

  it("all conclusive entries from multiple sources are merged", async () => {
    const sourceA: CatalogSource = {
      id: "source-a",
      list: async () => [
        {
          id: "a1",
          name: "A1",
          title: "A1",
          description: "d",
          kind: "agent",
          provenance: "operator",
          avatarKey: null,
        },
      ],
    };
    const sourceB: CatalogSource = {
      id: "source-b",
      list: async () => [
        {
          id: "b1",
          name: "B1",
          title: "B1",
          description: "d",
          kind: "skill",
          provenance: "operator",
          avatarKey: null,
        },
      ],
    };

    const catalog = createMarketplaceCatalog([sourceA, sourceB]);
    const result = await catalog.list();

    expect(result.map((e) => e.id).sort()).toEqual(["a1", "b1"]);
  });
});

// ---------------------------------------------------------------------------
// T10 V5 seam: bundled-only, operator double-merge, invalid source degradation
// ---------------------------------------------------------------------------

describe("V5 seam: bundled-only works zero-config", () => {
  it("returns bundled entries with no operator sources", async () => {
    const catalog = createMarketplaceCatalog([BUNDLED_CATALOG]);
    const entries = await catalog.list();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.provenance === "bundled")).toBe(true);
  });
});

describe("V5 seam: operator double-merge alongside bundled", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges bundled + operator sources without blocking", async () => {
    const operatorSource = createOperatorCatalogSource(
      "https://operator.example.com/marketplace-catalog.json",
    );
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        entries: [
          {
            id: "op-agent-1",
            name: "Operator Alpha",
            title: "Operator Alpha",
            description: "An operator agent",
            kind: "agent",
            provenance: "operator",
            avatarKey: null,
          },
        ],
      }),
    });

    const catalog = createMarketplaceCatalog([BUNDLED_CATALOG, operatorSource]);
    const entries = await catalog.list();

    expect(entries.some((e) => e.provenance === "bundled")).toBe(true);
    expect(entries.some((e) => e.id === "op-agent-1")).toBe(true);
  });

  it("operator entries coexist with bundled entries in result", async () => {
    const operatorSource = createOperatorCatalogSource(
      "https://operator2.example.com/marketplace.json",
    );
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        entries: [
          {
            id: "op-skill-1",
            name: "Operator Skill",
            title: "Operator Skill",
            description: "A skill from operator",
            kind: "skill",
            provenance: "operator",
            avatarKey: null,
          },
        ],
      }),
    });

    const catalog = createMarketplaceCatalog([BUNDLED_CATALOG, operatorSource]);
    const entries = await catalog.list();

    const operatorEntries = entries.filter((e) => e.provenance === "operator");
    const bundledEntries = entries.filter((e) => e.provenance === "bundled");
    expect(operatorEntries.length).toBe(1);
    expect(bundledEntries.length).toBeGreaterThan(0);
  });
});

describe("V5 seam: invalid operator source degrades to inconclusive skip", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("network error yields inconclusive — bundled still returned", async () => {
    const failingSource: CatalogSource = {
      id: "timeout-source",
      list: async () => {
        throw new Error("Connection timed out");
      },
    };
    const catalog = createMarketplaceCatalog([BUNDLED_CATALOG, failingSource]);
    const entries = await catalog.list();
    expect(entries.some((e) => e.provenance === "bundled")).toBe(true);
  });

  it("HTTP 500 from operator yields inconclusive — bundled still returned", async () => {
    const serverErrorSource = createOperatorCatalogSource(
      "https://failing-operator.example.com/catalog.json",
    );
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const catalog = createMarketplaceCatalog([BUNDLED_CATALOG, serverErrorSource]);
    const entries = await catalog.list();
    expect(entries.some((e) => e.provenance === "bundled")).toBe(true);
  });

  it("malformed JSON yields inconclusive — bundled still returned", async () => {
    const badSource = createOperatorCatalogSource(
      "https://bad-operator.example.com/catalog.json",
    );
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("JSON parse error");
      },
    });
    const catalog = createMarketplaceCatalog([BUNDLED_CATALOG, badSource]);
    const entries = await catalog.list();
    expect(entries.some((e) => e.provenance === "bundled")).toBe(true);
  });

  it("multiple failing sources degrade gracefully — bundled always present", async () => {
    const fail1: CatalogSource = {
      id: "fail-1",
      list: async () => {
        throw new Error("Source 1 down");
      },
    };
    const fail2: CatalogSource = {
      id: "fail-2",
      list: async () => ({
        id: "fail-2",
        inconclusive: true,
        reason: "Source 2 returned inconclusive",
      }),
    };
    const catalog = createMarketplaceCatalog([BUNDLED_CATALOG, fail1, fail2]);
    const entries = await catalog.list();
    expect(entries.filter((e) => e.provenance === "bundled").length).toBeGreaterThan(0);
  });
});
