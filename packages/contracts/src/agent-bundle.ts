/**
 * Agent Marketplace bundle — portable export/import format.
 *
 * Single JSON document (no ZIP). Total cap 2 MB enforced at schema level
 * (sum of all content-bearing string lengths) and at the RPC body limit.
 *
 * Security properties (per grill #1/#8/#9/#14):
 * - `.strict()` top-level rejects prototype-pollution keys and unknown fields.
 * - `version` is an exact literal; no fallback parsing.
 * - `mcpServers` omits headers/env/secretId entirely (schema rejects bundles
 *   that carry them).
 * - Skills have no `source` field in the bundle — import always forces
 *   `source: 'user'`.
 */

import * as z from "zod";
import { McpTransportSchema, isLocalMcpHost } from "./mcp.js";

// ---------------------------------------------------------------------------
// Length constants (bundle cap = 2 MB)
// ---------------------------------------------------------------------------
export const BUNDLE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Per-collection import caps. Each entry becomes at least one persisted row
 * (AgentSkill, or McpServer + BotMcpServer), so an unbounded count turns a
 * 2 MB document into an unbounded number of writes in one request.
 */
export const MAX_BUNDLE_SKILLS = 100;
export const MAX_BUNDLE_MCP_SERVERS = 25;

/** Shared max for skill.name / mcpServer.name / mcpServer.slug */
const NAME_MAX = 80;
/** Shared max for skill.description / mcpServer.description */
const DESCRIPTION_MAX = 500;
/** Max skill content (SKILL.md text) */
const CONTENT_MAX = 100_000;
/** Max MCP server endpoint URL */
const ENDPOINT_MAX = 500;

// ---------------------------------------------------------------------------
// Skill subset — .strict() so unknown keys like "source" are rejected
// ---------------------------------------------------------------------------
export const AgentBundleSkillSchema = z
  .object({
    name: z.string().min(1).max(NAME_MAX),
    description: z.string().max(DESCRIPTION_MAX),
    /** Full SKILL.md content */
    content: z.string().max(CONTENT_MAX),
  })
  .strict();
export type AgentBundleSkill = z.infer<typeof AgentBundleSkillSchema>;

// ---------------------------------------------------------------------------
// MCP server portable subset — .strict() so headers/env/secretId are rejected
// ---------------------------------------------------------------------------
/**
 * Transport enum — intentionally does NOT expose headers / env / secretId.
 * Schemas that try to include those fields are rejected by `.strict()`.
 */
export const AgentBundleMcpServerSchema = z
  .object({
    slug: z.string().min(1).max(NAME_MAX),
    name: z.string().min(1).max(NAME_MAX),
    description: z.string().max(DESCRIPTION_MAX),
    transport: McpTransportSchema,
    /**
     * Remote endpoint URL.
     *
     * Security: rejects loopback, link-local, and non-HTTPS schemes before the
     * bundle is ever persisted or served to other users. The McpConnector local-HTTP
     * opt-in is legitimate for operator-configured servers; this guard prevents a
     * third-party bundle from reaching it. Covers:
     * - 127.0.0.0/8, ::1, link-local (169.254/16, fe80::/10)
     * - file:, ftp: and other non-HTTP(S) schemes
     * - 0.0.0.0 (all IPv4 interfaces)
     *
     * See AGENT-BUNDLE-005.
     */
    endpoint: z
      .string()
      .url()
      .max(ENDPOINT_MAX)
      .refine(
        (value) => {
          try {
            const url = new URL(value);
            if (url.protocol !== "https:" && url.protocol !== "http:") return false;
            if (url.protocol === "http:") {
              // Reject local/loopback/link-local HTTP regardless of hostname
              if (isLocalMcpHost(url.hostname)) return false;
            }
            // Reject 0.0.0.0 (all IPv4 interfaces — not a real routable host)
            if (url.hostname === "0.0.0.0") return false;
            // Reject link-local unicast (169.254/16, fe80::/10)
            const hostLower = url.hostname.toLowerCase();
            if (
              hostLower === "169.254.0.0" ||
              hostLower.startsWith("169.254.") ||
              hostLower === "fe80" ||
              hostLower.startsWith("fe80:")
            )
              return false;
            return true;
          } catch {
            return false;
          }
        },
        { message: "Endpoint must be a public HTTPS URL (HTTP is only allowed for public hosts, not localhost or private ranges)" },
      ),
    /** stdio command (omit for HTTP transports) */
    command: z.string().max(500).optional(),
    /** stdio args */
    args: z.array(z.string()).max(50).optional(),
    /**
     * Allowlist of tool names the marketplace author declares.
     * Import creates a BotMcpServer with these as the sole allowed tools
     * and `allowAllTools = false`.
     */
    declaredTools: z.array(z.string()).max(500).optional(),
  })
  .strict();
export type AgentBundleMcpServer = z.infer<typeof AgentBundleMcpServerSchema>;

// ---------------------------------------------------------------------------
// Bot manifest (portable fields only) — .strict() catches unknown keys
// ---------------------------------------------------------------------------
export const AgentBundleManifestSchema = z
  .object({
    name: z.string().min(1).max(NAME_MAX),
    title: z.string().max(500),
    description: z.string().max(DESCRIPTION_MAX),
    instructions: z.string().max(20_000),
    /** Avatar key (bundled avatar reference); omitted = no bundled avatar */
    avatarKey: z.string().max(NAME_MAX).optional(),
    /** Expert this was originally created from (if any) */
    expertKey: z.string().max(NAME_MAX).optional(),
    /** Model provider to configure on import */
    modelProvider: z.string().max(NAME_MAX).optional(),
    /** Model ID to configure on import */
    modelId: z.string().max(NAME_MAX).optional(),
    /** Thinking level */
    thinkingLevel: z.enum(["off", "low", "medium", "high"]).optional(),
    /** Bot color string (data URL or palette ref) */
    color: z.string().max(200).optional(),
  })
  .strict();
export type AgentBundleManifest = z.infer<typeof AgentBundleManifestSchema>;

// ---------------------------------------------------------------------------
// Bundle root — strict to catch proto-pollution / unknown keys
// ---------------------------------------------------------------------------
/**
 * Full agent bundle schema.
 *
 * `.strict()` ensures any `__proto__`, `constructor`, or other unknown top-level
 * key causes immediate parse failure (V2 rejection).
 *
 * The 2 MB cap is enforced by:
 * 1. Schema-level `.max()` on every content-bearing string (sum of all fields
 *    ≤ BUNDLE_MAX_BYTES in practice).
 * 2. RPC body-limit middleware on the API server (proven existing pattern).
 */
export const AgentBundleSchema = z
  .object({
    version: z.literal("1"),
    /** ISO-8601 export timestamp */
    exportedAt: z.string().datetime({ offset: true }).max(100),
    manifest: AgentBundleManifestSchema,
    // Counts are bounded because each entry becomes a DB row on import. The 2 MB
    // cap alone does not bound row amplification: a bundle of minimal skills can
    // stay well under it while still creating thousands of records.
    skills: z.array(AgentBundleSkillSchema).max(MAX_BUNDLE_SKILLS),
    /**
     * MCP servers described in the bundle.
     * Headers / env / secretId are NEVER serialised — they are absent from
     * this schema, so bundles that carry them are rejected by `.strict()`.
     */
    mcpServers: z.array(AgentBundleMcpServerSchema).max(MAX_BUNDLE_MCP_SERVERS),
    /** Bundled avatar key (if any) */
    avatarKey: z.string().max(NAME_MAX).optional(),
  })
  .strict()
  .refine(
    (bundle) => {
      // Schema-level 2 MB cap: sum of all content strings
      const meter = new Blob([
        bundle.exportedAt,
        bundle.manifest.name,
        bundle.manifest.title ?? "",
        bundle.manifest.description ?? "",
        bundle.manifest.instructions ?? "",
        bundle.manifest.avatarKey ?? "",
        bundle.manifest.expertKey ?? "",
        bundle.manifest.modelProvider ?? "",
        bundle.manifest.modelId ?? "",
        bundle.manifest.color ?? "",
        bundle.avatarKey ?? "",
        ...bundle.skills.flatMap((s) => [s.name, s.description, s.content]),
        ...bundle.mcpServers.flatMap((m) => [
          m.slug,
          m.name,
          m.description ?? "",
          m.endpoint,
          m.command ?? "",
          ...(m.args ?? []),
          ...(m.declaredTools ?? []),
        ]),
      ]).size;
      return meter <= BUNDLE_MAX_BYTES;
    },
    { message: `Bundle exceeds ${BUNDLE_MAX_BYTES / 1024 / 1024} MB size limit` },
  );

export type AgentBundle = z.infer<typeof AgentBundleSchema>;

// ---------------------------------------------------------------------------
// Two-phase import tokens
// ---------------------------------------------------------------------------

/** Output of agents.previewImport — the data shown on the review screen */
export const ImportPreviewSchema = z.object({
  manifest: AgentBundleManifestSchema,
  skills: z.array(AgentBundleSkillSchema),
  mcpServers: z.array(AgentBundleMcpServerSchema),
  avatarKey: z.string().max(NAME_MAX).optional(),
  /**
   * HMAC-signed, time-limited import token.
   * Format: `${bundleHash}.${expiryMs}.${hmacHex}`
   * Passed to agents.import to commit the import.
   */
  importToken: z.string(),
  /** Fields whose content triggered the containsSecret scan (for user notice) */
  secretFlaggedFields: z.array(z.string()).optional(),
});
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

/** Input for agents.import */
export const ImportCommitInputSchema = z.object({
  importToken: z.string().min(1),
  /** Must be true to execute the import */
  confirm: z.literal(true),
});
export type ImportCommitInput = z.infer<typeof ImportCommitInputSchema>;
