import { describe, expect, it } from "vitest";
import { EXPERT_CATALOG } from "./experts.js";
import {
  CATALOG_VERSION,
  INSPIRATION_CATALOG,
  InspirationCaseSchema,
  validateInspirationCatalog,
} from "./inspiration-catalog.js";

describe("inspiration-catalog", () => {
  it("CATALOG_VERSION is a non-empty string", () => {
    expect(typeof CATALOG_VERSION).toBe("string");
    expect(CATALOG_VERSION.length).toBeGreaterThan(0);
  });

  it("INSPIRATION_CATALOG has 5-8 cases", () => {
    expect(INSPIRATION_CATALOG.length).toBeGreaterThanOrEqual(5);
    expect(INSPIRATION_CATALOG.length).toBeLessThanOrEqual(8);
  });

  it("every case has a unique key", () => {
    const keys = INSPIRATION_CATALOG.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every case parses against InspirationCaseSchema", () => {
    for (const c of INSPIRATION_CATALOG) {
      expect(() => InspirationCaseSchema.parse(c)).not.toThrow();
    }
  });

  it("every expertKey resolves via findExpert", () => {
    const errors = validateInspirationCatalog(EXPERT_CATALOG);
    expect(errors).toHaveLength(0);
  });

  it("validateInspirationCatalog returns errors for unknown expertKeys", () => {
    const result = validateInspirationCatalog([]);
    expect(result.length).toBe(INSPIRATION_CATALOG.length);
    expect(result[0]).toMatch(/expertKey.*not found/);
  });

  it("every visualAssetPath is a non-empty string ending in .svg", () => {
    for (const c of INSPIRATION_CATALOG) {
      expect(c.visualAssetPath).toMatch(/^.+\.svg$/);
    }
  });

  it("every case has at least one tag", () => {
    for (const c of INSPIRATION_CATALOG) {
      expect(c.tags.length).toBeGreaterThan(0);
    }
  });

  it("rejects a malformed case at the schema boundary", () => {
    expect(() =>
      InspirationCaseSchema.parse({ key: 1, title: "x", description: "y", expertKey: "z", visualAssetPath: "a.svg", tags: [] }),
    ).toThrow();
  });
});
