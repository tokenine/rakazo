/**
 * Agent marketplace catalog — catalog source interface and bundled agent entries.
 *
 * Pure data: no runtime imports. Copy is Thai-first; refine here without
 * touching any flow code.
 */

import { z } from "zod";
import { EXPERT_CATALOG } from "./experts.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Kind chip values shown on marketplace cards. */
export const CatalogEntryKindSchema = z.enum(["agent", "skill", "mcp"]);
export type CatalogEntryKind = z.infer<typeof CatalogEntryKindSchema>;

/** Provenance badge — how the entry arrived in the catalog. */
export const ProvenanceSchema = z.enum(["bundled", "operator", "registry"]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** A single entry in the marketplace catalog. */
export const CatalogEntrySchema = z.object({
  /** Stable identifier within the catalog. */
  id: z.string(),
  /** Machine-safe name (used in import). */
  name: z.string(),
  /** Display title. */
  title: z.string(),
  /** One-line description. */
  description: z.string(),
  /** Kind chip — determines which filter tab shows this entry. */
  kind: CatalogEntryKindSchema,
  /** Provenance badge — Bundled | Operator | Registry. */
  provenance: ProvenanceSchema,
  /** Avatar asset key; null means use initials. */
  avatarKey: z.string().nullable(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

/** An entry from a source that failed to load — inconclusive, not an error. */
export const SkippedCatalogEntrySchema = z.object({
  id: z.string(),
  inconclusive: z.literal(true),
  reason: z.string(),
});
export type SkippedCatalogEntry = z.infer<typeof SkippedCatalogEntrySchema>;

/** Output of a CatalogSource.list() call. */
export const CatalogSourceResultSchema = z.union([
  z.array(CatalogEntrySchema),
  SkippedCatalogEntrySchema,
]);
export type CatalogSourceResult = z.infer<typeof CatalogSourceResultSchema>;

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/** Increment when catalog content changes to bust client caches. */
export const MARKETPLACE_CATALOG_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// CatalogSource interface
// ---------------------------------------------------------------------------

/**
 * A catalog source fetches entries from one provider.
 * The source id is used as a cache key; list() must be idempotent.
 */
export interface CatalogSource {
  readonly id: string;
  list(): Promise<CatalogSourceResult>;
}

// ---------------------------------------------------------------------------
// Bundled provider — static data from the expertise catalog
// ---------------------------------------------------------------------------

/** Bundled catalog source — static, no network required. */
export const BUNDLED_CATALOG: CatalogSource = {
  id: "bundled",
  async list() {
    return EXPERT_CATALOG.map(
      (expert): CatalogEntry => ({
        id: `bundled:${expert.key}`,
        name: expert.name,
        title: expert.name,
        description: expert.description ?? expert.name,
        kind: "agent",
        provenance: "bundled",
        avatarKey: expert.avatarKey ?? null,
      }),
    );
  },
};

// ---------------------------------------------------------------------------
// Operator URL provider
// ---------------------------------------------------------------------------

const OPERATOR_ENTRY_SCHEMA = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  kind: CatalogEntryKindSchema,
  provenance: z.enum(["operator", "registry"]),
  avatarKey: z.string().nullable(),
});

const OPERATOR_CATALOG_SCHEMA = z.object({
  entries: z.array(OPERATOR_ENTRY_SCHEMA),
});

/**
 * Creates an operator URL catalog source.
 * URL must be HTTPS. Fetch is validated and errors become SkippedCatalogEntry.
 */
export function createOperatorCatalogSource(url: string): CatalogSource {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid catalog URL");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Operator catalog URL must use HTTPS");
  }

  return {
    id: url,
    async list() {
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      } catch (err) {
        return {
          id: url,
          inconclusive: true,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
      if (!response.ok) {
        return {
          id: url,
          inconclusive: true,
          reason: `HTTP ${response.status}`,
        };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { id: url, inconclusive: true, reason: "Invalid JSON response" };
      }

      const parsed = OPERATOR_CATALOG_SCHEMA.safeParse(body);
      if (!parsed.success) {
        return {
          id: url,
          inconclusive: true,
          reason: "Invalid catalog payload",
        };
      }

      return parsed.data.entries.map((e) => ({ ...e, provenance: e.provenance as Provenance }));
    },
  };
}

// ---------------------------------------------------------------------------
// Marketplace catalog — merge across multiple sources
// ---------------------------------------------------------------------------

/**
 * Creates a marketplace catalog that merges results from all given sources.
 * A failed source yields an inconclusive skipped item and NEVER blocks
 * the bundled results. Only conclusive (array) results are returned;
 * inconclusive items are dropped (logged internally if needed).
 */
export function createMarketplaceCatalog(sources: CatalogSource[]): CatalogSource {
  return {
    id: "marketplace",
    async list() {
      const entries: CatalogEntry[] = [];

      await Promise.all(
        sources.map(async (source) => {
          try {
            const result = await source.list();
            if (Array.isArray(result)) {
              entries.push(...result);
            }
            // Inconclusive items are dropped — callers can use the source directly
            // to observe individual results if needed.
          } catch {
            // Swallowed: a throwing source does not block the merge.
          }
        }),
      );

      return entries;
    },
  };
}
