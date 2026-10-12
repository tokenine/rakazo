// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

/**
 * V3 token gate (002 convergence T12): the hub and welcome surfaces must carry
 * zero hardcoded colors — constitution §5 requires semantic tokens only. The
 * tdd-log previously recorded a manual grep that did not hold on this tree, so
 * the gate now runs as a deterministic test. Bot identity colors arrive as
 * runtime data (bot.color), never as literals in these files.
 */

const SURFACES = ["HubPage.tsx", "MarketplacePage.tsx", "Welcome.tsx"].map((name) => path.join(import.meta.dirname, name));

const HARDCODED_COLOR =
  /#[0-9a-fA-F]{3,8}\b|rgba?\(|\b(?:text|bg|border|shadow)-(?:white|black|(?:orange|amber|rose|red|green|emerald|sky|blue|indigo|violet|purple|fuchsia|pink|slate|gray|zinc|neutral|stone|yellow|lime|teal|cyan)-[0-9]{2,3})\b|\[var\(--/;

it.each(SURFACES.map((file) => path.basename(file)))(
  "%s carries no hardcoded colors (constitution §5)",
  (name) => {
    const source = readFileSync(SURFACES.find((file) => file.endsWith(name))!, "utf8");
    const matches = [...source.matchAll(new RegExp(HARDCODED_COLOR, "g"))].map((match) => match[0]);
    expect(matches, `${name} hardcodes colors: ${matches.join(", ")}`).toEqual([]);
  },
);
