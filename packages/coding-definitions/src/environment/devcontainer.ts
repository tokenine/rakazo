/**
 * T27 — Q7 Setup Definition: environment parser interface + devcontainer.json subset parser.
 *
 * Parser seam: swap the IEnvironmentParser implementation to support a custom format
 * without changing calling code.
 *
 * Accepted keys (stored as-is, mapped onto the Q9 process runtime):
 *   - postCreateCommand
 *   - forwardPorts
 *   - features-lite: { name, url, dest }
 *   - customizations
 *
 * Container-only keys are disclosed via `disclosedContainerKeys` but NOT applied.
 * Reversal: swap the parser behind the IEnvironmentParser seam.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Subset of a devcontainer.json features block that Rakazo Code uses. */
const FeatureLiteSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  dest: z.string().optional(),
});

/** The devcontainer.json keys that Rakazo Code reads and applies. */
const DevcontainerSubsetSchema = z.object({
  /** Command to run after the environment is created. */
  postCreateCommand: z.union([z.string(), z.array(z.string())]).optional(),
  /** Port mappings to expose from the environment. */
  forwardPorts: z.array(z.number()).optional(),
  /**
   * Lightweight feature list — only name/url/dest are used.
   * Full features objects are parsed but only these three fields are retained.
   */
  features: z.record(z.union([z.string(), z.record(z.unknown())])).optional(),
  /** Tool-specific customizations. */
  customizations: z.record(z.unknown()).optional(),
});

export type DevcontainerSubset = z.infer<typeof DevcontainerSubsetSchema>;

/** Feature entry normalized to the features-lite shape. */
export interface FeatureLite {
  name: string;
  url?: string;
  dest?: string;
}

/**
 * Result of parsing a devcontainer.json.
 * `disclosedContainerKeys` contains keys that were present but are container-only
 * (not used by Rakazo Code). Callers may surface these as a warning.
 */
export interface ParsedEnvironment {
  /** The subset of keys Rakazo Code actually applies. */
  definition: {
    postCreateCommand?: string | string[];
    forwardPorts?: number[];
    features: FeatureLite[];
    customizations?: Record<string, unknown>;
  };
  /** Keys present in the source but NOT used by Rakazo Code. */
  disclosedContainerKeys: string[];
}

const CONTAINER_ONLY_KEYS: Record<string, true> = {
  image: true,
  dockerFile: true,
  containerEnv: true,
  remoteEnv: true,
  runArgs: true,
  mounts: true,
  workspaceFolder: true,
  settings: true,
  extensions: true,
  portsAttributes: true,
  shutdownAction: true,
  onOpenCommand: true,
  initializeCommand: true,
  waitFor: true,
  "host.systemDeps": true,
  vson: true,
};

// ---------------------------------------------------------------------------
// Parser interface (seam for custom format swap-in)
// ---------------------------------------------------------------------------

/**
 * Environment definition parser. Swap implementations to support custom formats.
 * The seam lives in packages/coding-definitions/src/environment/parsers/.
 */
export interface IEnvironmentParser {
  /** Human-readable name of this parser's format. */
  readonly formatName: string;

  /**
   * Parse a raw object (e.g. parsed JSON) into a normalized environment definition.
   * On parse error, return null.
   */
  parse(raw: unknown): ParsedEnvironment | null;
}

// ---------------------------------------------------------------------------
// Devcontainer subset parser
// ---------------------------------------------------------------------------

/** Normalize a raw features record into FeatureLite entries. */
function normalizeFeatures(
  raw: DevcontainerSubset["features"],
): FeatureLite[] {
  if (!raw) return [];
  const entries: FeatureLite[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      entries.push({ name: id, url: value });
    } else if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      entries.push({
        name: id,
        url: typeof obj.url === "string" ? obj.url : undefined,
        dest: typeof obj.dest === "string" ? obj.dest : undefined,
      });
    }
  }
  return entries;
}

export class DevcontainerParser implements IEnvironmentParser {
  readonly formatName = "devcontainer.json (subset)";

  parse(raw: unknown): ParsedEnvironment | null {
    if (typeof raw !== "object" || raw === null) return null;

    const result = DevcontainerSubsetSchema.safeParse(raw);
    if (!result.success) return null;

    const data = result.data;
    const disclosedContainerKeys =
      typeof raw === "object"
        ? Object.keys(raw as Record<string, unknown>).filter((k) => k in CONTAINER_ONLY_KEYS)
        : [];

    // Also mark features-lite-only fields that we DON'T use from the full features object
    // (version, options, etc.) — but only collect top-level container keys above.

    return {
      definition: {
        postCreateCommand: data.postCreateCommand,
        forwardPorts: data.forwardPorts,
        features: normalizeFeatures(data.features),
        customizations: data.customizations,
      },
      disclosedContainerKeys,
    };
  }
}

// ---------------------------------------------------------------------------
// Composite parser that tries multiple formats
// ---------------------------------------------------------------------------

/** Default registry of parsers, ordered by priority. */
const DEFAULT_PARSERS: IEnvironmentParser[] = [new DevcontainerParser()];

export class CompositeEnvironmentParser implements IEnvironmentParser {
  readonly formatName = "auto-detect";
  private readonly parsers: readonly IEnvironmentParser[];

  constructor(parsers: readonly IEnvironmentParser[] = DEFAULT_PARSERS) {
    this.parsers = parsers;
  }

  /** Register a parser. New parsers are tried before existing ones. */
  prepend(parser: IEnvironmentParser): CompositeEnvironmentParser {
    return new CompositeEnvironmentParser([parser, ...this.parsers]);
  }

  parse(raw: unknown): ParsedEnvironment | null {
    for (const parser of this.parsers) {
      const result = parser.parse(raw);
      if (result) return result;
    }
    return null;
  }
}
