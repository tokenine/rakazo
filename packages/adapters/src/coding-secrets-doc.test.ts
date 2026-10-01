import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 004-code-mode S3 (T20, V9 doc row) — the docs/bot-secrets.md carve-out
 * annotation. The ANNOTATION sits at the very top of the doc: reusable
 * API-credential refusal is superseded FOR 004-CODE-MODE TASK RUNTIMES ONLY,
 * with a pointer to the Q10 decision record; the blanket refusal stands
 * everywhere else. The doc is NOT rewritten — the original boundary text
 * must still be present below the annotation.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const docPath = path.join(repoRoot, "docs", "bot-secrets.md");
const doc = readFileSync(docPath, "utf8");

describe("bot-secrets.md carve-out annotation (T20)", () => {
  it("carries the annotation at the very top of the doc", () => {
    const head = doc.slice(0, 1600);
    expect(head).toMatch(/004-code-mode/i);
    expect(head).toMatch(/superseded/i);
    expect(head).toMatch(/task runtime/i);
    expect(head).toMatch(/decision\.json/i);
  });

  it("the annotation states the boundary that still applies", () => {
    const head = doc.slice(0, 1600);
    expect(head).toMatch(/blanket refusal stands/i);
  });

  it("does NOT rewrite the doc: the original blanket-refusal boundary text remains", () => {
    expect(doc).toMatch(/Injecting credentials into arbitrary AI-controlled shell commands/);
    expect(doc).toMatch(/those paths are not exposed/);
  });

  it("keeps the annotation scoped: it does not claim a general policy change", () => {
    const head = doc.slice(0, 1600);
    expect(head).toMatch(/only/i);
    expect(head).toMatch(/audited/i);
  });
});
