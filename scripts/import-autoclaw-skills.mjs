#!/usr/bin/env node
/**
 * Generate packages/contracts/src/skill-store.generated.ts from a local AutoClaw
 * (openclaw) skills directory (~/.openclaw-autoclaw/skills).
 *
 * Only portable skills are imported: entries whose SKILL.md depends on the
 * AutoClaw desktop runtime (local gateway endpoints, AutoGLM APIs, IM cron,
 * hermes evolution tools) are skipped via SKIP below.
 *
 * Usage: node scripts/import-autoclaw-skills.mjs [--src <dir>] [--out <file>]
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const SRC = resolve(argValue("--src", join(homedir(), ".openclaw-autoclaw", "skills")));
const OUT = resolve(
  argValue("--out", join(repoRoot, "packages", "contracts", "src", "skill-store.generated.ts")),
);

const CATEGORIES = [
  "Research",
  "Utilities",
  "Productivity",
  "Development",
  "Content Creation",
  "Finance & Trading",
];

/** Skills bound to the AutoClaw desktop runtime — not usable inside the Ai7 sandbox. */
const SKIP = new Set([
  "autoclaw-design-capability",
  "autoclaw-design-capability_noqa",
  "autoclaw-im-cron",
  "autoclaw-pdf-ocr",
  "autoglm-browser-agent-mac",
  "autoglm-file-upload",
  "autoglm-generate-image-seedream",
  "autoglm-image-recognition",
  "autoglm-remove-bg",
  "deep-research",
  "fc-nginx-website",
  "feishu-cron-reminder",
  "gildata-finance-data",
  "hermes-evolution",
]);

/** Hand-curated category per imported skill (one of CATEGORIES). */
const CATEGORY_BY_KEY = {
  "1password": "Utilities",
  "aesthetic-preset-library": "Content Creation",
  agentcash: "Finance & Trading",
  "daily-ai-news": "Research",
  "delivery-artifact": "Content Creation",
  "financial-suite": "Finance & Trading",
  "find-skills": "Utilities",
  "infinite-canvas-output": "Content Creation",
  "market-research": "Research",
  memory: "Productivity",
  "mpp-bridge---tempo-to-thaichain": "Finance & Trading",
  "news-aggregator": "Research",
  "news-summary": "Research",
  pdf: "Productivity",
  ppt: "Content Creation",
  pptx: "Content Creation",
  "skill-creator": "Development",
  "tiktok-strategist": "Content Creation",
  "website-builder": "Development",
  xlsx: "Productivity",
};

const MAX_NAME = 80;
const MAX_DESCRIPTION = 2000;
const MAX_CONTENT = 100_000;

function parseFrontmatterScalar(raw) {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Minimal YAML frontmatter reader: scalars plus `>`/`|` block scalars. */
function parseFrontmatter(text) {
  const fence = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = fence.exec(text);
  if (!match) throw new Error("missing frontmatter fence");
  const result = {};
  const lines = match[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const keyed = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!keyed) {
      i += 1;
      continue;
    }
    const key = keyed[1];
    const raw = keyed[2] ?? "";
    const block = /^([>|])([+-]?\d*)([+-]?)?$/.exec(raw);
    if (block) {
      const chomp = block[3] === "-" ? "strip" : block[3] === "+" ? "keep" : "clip";
      const literal = block[1] === "|";
      const body = [];
      i += 1;
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === "")) {
        body.push(lines[i]);
        i += 1;
      }
      while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
      let indent = null;
      for (const entry of body) {
        if (entry.trim() === "") continue;
        const spaces = /^ */.exec(entry)[0].length;
        indent = indent === null || spaces < indent ? spaces : indent;
      }
      const parts = [];
      let paragraph = [];
      const flush = () => {
        if (paragraph.length > 0) parts.push(paragraph.join(" "));
        paragraph = [];
      };
      for (const entry of body) {
        if (entry.trim() === "") {
          flush();
          parts.push("");
          continue;
        }
        const line = indent === null ? entry.trimStart() : entry.slice(indent);
        if (!literal && /^ /.test(line)) {
          flush();
          parts.push(line);
          continue;
        }
        if (literal) {
          parts.push(line);
        } else {
          paragraph.push(line);
        }
      }
      flush();
      let value = parts.join("\n");
      if (chomp === "strip") value = value.replace(/\n+$/, "");
      else if (chomp === "keep") value = `${value.replace(/\n+$/, "")}\n`;
      else value = value.replace(/\n+$/, "") ? `${value.replace(/\n+$/, "")}\n` : "";
      result[key] = value;
      continue;
    }
    result[key] = parseFrontmatterScalar(raw);
    i += 1;
  }
  return result;
}

const entries = [];
const skipped = [];
for (const dir of readdirSync(SRC, { withFileTypes: true }).sort((a, b) =>
  a.name.localeCompare(b.name),
)) {
  if (SKIP.has(dir.name)) continue;
  // Follow symlinked skill dirs (AutoClaw links personal skills from ~/.agents/skills).
  let isDir;
  try {
    isDir = statSync(join(SRC, dir.name)).isDirectory();
  } catch {
    continue; // broken symlink
  }
  if (!isDir) continue;
  const file = join(SRC, dir.name, "SKILL.md");
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue; // no SKILL.md — not a skill directory
  }
  let frontmatter;
  try {
    frontmatter = parseFrontmatter(content);
  } catch (error) {
    skipped.push(
      `${dir.name}: ${error instanceof Error ? error.message : "unparseable frontmatter"}`,
    );
    continue;
  }
  const name = String(frontmatter.name ?? "").trim();
  const description = String(frontmatter.description ?? "").trim();
  if (!name || !description) {
    skipped.push(`${dir.name}: missing name/description in frontmatter`);
    continue;
  }
  if (name.length > MAX_NAME) {
    skipped.push(`${dir.name}: name too long`);
    continue;
  }
  if (description.length > MAX_DESCRIPTION) {
    skipped.push(`${dir.name}: description too long`);
    continue;
  }
  if (content.length > MAX_CONTENT) {
    skipped.push(`${dir.name}: content too large`);
    continue;
  }
  const category = CATEGORY_BY_KEY[dir.name];
  if (!category || !CATEGORIES.includes(category)) {
    skipped.push(`${dir.name}: no category mapping`);
    continue;
  }
  entries.push({ key: dir.name, name, description, category, content });
}

if (skipped.length > 0) {
  console.log(`Skipped ${skipped.length}:`);
  for (const line of skipped) console.log(`  ${line}`);
}
const missing = Object.keys(CATEGORY_BY_KEY).filter((key) => !entries.some((e) => e.key === key));
if (missing.length > 0) {
  console.error(`Category map has entries not found on disk: ${missing.join(", ")}`);
  process.exit(1);
}

const payload = JSON.stringify({ version: 1, categories: CATEGORIES, skills: entries }, null, 2);
const header = `/**
 * GENERATED by \`node scripts/import-autoclaw-skills.mjs\` — do not edit by hand.
 * Source: AutoClaw (openclaw) skills directory; portable skills only.
 */
export const SKILL_STORE_JSON = ${JSON.stringify(payload)};
`;

writeFileSync(OUT, header);
console.log(`Wrote ${OUT}`);
console.log(`Imported ${entries.length} skills:`);
for (const entry of entries) {
  console.log(`  ${entry.key.padEnd(34)} ${entry.category}  (${entry.content.length} chars)`);
}
if (skipped.length > 0) {
  console.log(`Skipped ${skipped.length}:`);
  for (const line of skipped) console.log(`  ${line}`);
}
