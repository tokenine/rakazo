/**
 * Inspiration catalog — curated example cases shown on the hub/home surface.
 *
 * Each case references an Expert via `expertKey` so "Make similar" can reuse
 * `experts.createFromExpert`. Visual assets are bundled grayscale SVGs that
 * work on both light and dark backgrounds.
 *
 * Pure data: no runtime imports. Copy is Thai-first; refine here without
 * touching any flow code.
 */

import { z } from "zod";
import type { ExpertDefinition } from "./experts.js";
import { findExpert } from "./experts.js";

/** A single inspiration case shown as a gallery card. */
export const InspirationCaseSchema = z.object({
  /** Stable identifier within the catalog. */
  key: z.string(),
  /** Card title. */
  title: z.string(),
  /** One-line description. */
  description: z.string(),
  /**
   * References an ExpertDefinition.key. "Make similar" calls
   * `bots.createFromExpert({ expertKey })` for this value.
   */
  expertKey: z.string(),
  /**
   * Path to a bundled visual asset (SVG/WebP). Relative to
   * `packages/contracts/assets/inspiration/`.
   */
  visualAssetPath: z.string(),
  /** Taxonomy tags for filtering. */
  tags: z.array(z.string()),
});
export type InspirationCase = z.infer<typeof InspirationCaseSchema>;

/** Increment when catalog content changes to bust client caches. */
export const CATALOG_VERSION = "1.0.0" as const;

export const INSPIRATION_CATALOG: InspirationCase[] = [
  {
    key: "market-research",
    title: "วิจัยตลาด",
    description: "วิเคราะห์คู่แข่งและเทรนด์ในอุตสาหกรรม",
    expertKey: "marketing",
    visualAssetPath: "market-research.svg",
    tags: ["research", "marketing"],
  },
  {
    key: "code-review",
    title: "ตรวจโค้ด",
    description: "ทบทวน PR ก่อน merge พร้อมข้อเสนอแก้ไข",
    expertKey: "coder",
    visualAssetPath: "code-review.svg",
    tags: ["development", "code"],
  },
  {
    key: "cloud-infra",
    title: "จัดการ Cloud",
    description: "Deploy และ monitor บน Cloudflare อัตโนมัติ",
    expertKey: "cloudops",
    visualAssetPath: "cloud-infra.svg",
    tags: ["infrastructure", "cloud"],
  },
  {
    key: "notion-knowledge",
    title: "จัด知识库",
    description: "สร้างและอัปเดตฐานความรู้ใน Notion",
    expertKey: "chief",
    visualAssetPath: "notion-knowledge.svg",
    tags: ["knowledge", "productivity"],
  },
  {
    key: "content-calendar",
    title: "วางแผนคอนเทนต์",
    description: "สร้างปฏิทินคอนเทนต์เดือนละชุด",
    expertKey: "marketing",
    visualAssetPath: "content-calendar.svg",
    tags: ["marketing", "content"],
  },
  {
    key: "github-automation",
    title: "GitHub automation",
    description: "จัดการ issue และ PR แบบอัตโนมัติ",
    expertKey: "coder",
    visualAssetPath: "github-automation.svg",
    tags: ["development", "automation"],
  },
];

/**
 * Validate every case's expertKey resolves to a real Expert.
 * Returns an array of error messages; empty array means valid.
 */
export function validateInspirationCatalog(
  experts: readonly ExpertDefinition[],
): string[] {
  const errors: string[] = [];
  for (const c of INSPIRATION_CATALOG) {
    const expert = experts.find((e) => e.key === c.expertKey);
    if (!expert) {
      errors.push(`Case "${c.key}": expertKey "${c.expertKey}" not found in EXPERT_CATALOG`);
    }
  }
  return errors;
}
