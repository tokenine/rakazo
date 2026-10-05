/**
 * Skill Store: bundled, curated SKILL.md skills installable per user from the
 * Skills & Connectors page. Content is imported from AutoClaw's portable skill
 * set by `scripts/import-autoclaw-skills.mjs` (see skill-store.generated.ts).
 */

import { SKILL_STORE_JSON } from "./skill-store.generated.js";

export const SKILL_STORE_CATEGORIES = [
  "Research",
  "Utilities",
  "Productivity",
  "Development",
  "Content Creation",
  "Finance & Trading",
] as const;
export type SkillStoreCategory = (typeof SKILL_STORE_CATEGORIES)[number];

export type SkillStoreEntry = {
  /** Stable slug (source directory name); used as AgentSkill.storeKey. */
  key: string;
  name: string;
  description: string;
  category: SkillStoreCategory;
  /** Full SKILL.md document (frontmatter included). */
  content: string;
};

type SkillStorePayload = {
  version: number;
  categories: string[];
  skills: SkillStoreEntry[];
};

function loadSkillStore(): SkillStoreEntry[] {
  const payload = JSON.parse(SKILL_STORE_JSON) as SkillStorePayload;
  return payload.skills.filter(
    (entry): entry is SkillStoreEntry =>
      typeof entry.key === "string" &&
      typeof entry.name === "string" &&
      typeof entry.description === "string" &&
      typeof entry.content === "string" &&
      (SKILL_STORE_CATEGORIES as readonly string[]).includes(entry.category),
  );
}

export const SKILL_STORE: SkillStoreEntry[] = loadSkillStore();

export function findSkillStoreEntry(key: string): SkillStoreEntry | undefined {
  return SKILL_STORE.find((entry) => entry.key === key);
}
