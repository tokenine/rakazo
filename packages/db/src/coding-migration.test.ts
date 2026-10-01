import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dbDir = dirname(fileURLToPath(import.meta.url));
const prismaDir = join(dbDir, "..", "prisma");
const migrationsDir = join(prismaDir, "migrations");
const schemaSql = readFileSync(join(prismaDir, "schema.prisma"), "utf8");

/**
 * LOW-3 (fix round): a second coding migration adds the latestRunId index the
 * acceptance gate looks up by. The original coding migration is untouched —
 * the index is a NEW, ordered-after migration directory.
 */
const CODING_MIGRATIONS = [
  "20261001050500_coding_sessions_lease",
  "20261002000000_coding_session_latest_run_idx",
] as const;

function migrationSql(name: string): string {
  return readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
}

/** Existing tables before the coding migrations (from schema.prisma @@map names). */
function existingMappedTables(): Set<string> {
  const maps = [...schemaSql.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]!);
  return new Set(
    maps.filter((name) => !["coding_sessions", "coding_workspace_leases"].includes(name)),
  );
}

const NEW_TABLES = new Set(["coding_sessions", "coding_workspace_leases"]);

describe("coding migrations are additive (V14, T1)", () => {
  it("every coding migration only creates tables/indexes — no drops, alters, renames, or rewrites", () => {
    for (const name of CODING_MIGRATIONS) {
      const statements = migrationSql(name)
        .replace(/--[^\n]*/g, "")
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX)\b/);
        expect(statement).not.toMatch(/\b(DROP|ALTER|RENAME|TRUNCATE|UPDATE|DELETE|INSERT)\b/i);
      }
    }
  });

  it("every coding migration touches only the two new coding tables — existing tables are untouched", () => {
    const existing = existingMappedTables();
    for (const name of CODING_MIGRATIONS) {
      const referenced = new Set<string>();
      for (const match of migrationSql(name).matchAll(
        /(?:TABLE|INDEX)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*(?:\(|ON)/gi,
      )) {
        referenced.add(match[1]!);
      }
      for (const match of migrationSql(name).matchAll(/CREATE TABLE "([^"]+)"/gi)) {
        referenced.add(match[1]!);
      }
      for (const table of referenced) {
        expect(NEW_TABLES.has(table) || !existing.has(table)).toBe(true);
        expect(existing.has(table)).toBe(false);
      }
    }
  });

  it("each coding migration is ordered after every earlier migration (timestamp-named directories)", () => {
    const all = readdirSync(migrationsDir).filter((name) => /^\d{14}_/.test(name));
    const codingSet = new Set<string>(CODING_MIGRATIONS);
    for (const name of CODING_MIGRATIONS) {
      expect(existsSync(join(migrationsDir, name, "migration.sql"))).toBe(true);
    }
    // The coding migrations themselves run in their listed order...
    expect([...CODING_MIGRATIONS].sort()).toEqual([...CODING_MIGRATIONS]);
    for (const other of all) {
      if (codingSet.has(other)) continue;
      // ...and every non-coding migration predates the first coding one.
      expect(other < CODING_MIGRATIONS[0]).toBe(true);
    }
  });

  it("the latestRunId index exists as a NEW migration — the original coding migration is untouched", () => {
    const indexMigration = migrationSql("20261002000000_coding_session_latest_run_idx");
    expect(indexMigration).toMatch(
      /CREATE INDEX "coding_sessions_latestRunId_idx" ON "coding_sessions"\("latestRunId"\);/,
    );
    // Exactly one statement: the index. Nothing else rides along.
    const statements = indexMigration
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements).toHaveLength(1);
  });

  it("the schema declares the session bound to (workspaceId, engine), the lease table, and the gate lookup index", () => {
    expect(schemaSql).toMatch(/model CodingSession \{/);
    expect(schemaSql).toMatch(/model CodingWorkspaceLease \{/);
    const sessionBlock = schemaSql.slice(
      schemaSql.indexOf("model CodingSession {"),
      schemaSql.indexOf("model CodingWorkspaceLease {"),
    );
    expect(sessionBlock).toMatch(/workspaceId\s+String/);
    expect(sessionBlock).toMatch(/engine\s+String/);
    expect(sessionBlock).toMatch(/latestRunId\s+String\?/);
    // LOW-3: the gate's lookup column carries its own index.
    expect(sessionBlock).toMatch(/@@index\(\[latestRunId\]\)/);
    expect(sessionBlock).toMatch(/@@map\("coding_sessions"\)/);
    const leaseBlock = schemaSql.slice(schemaSql.indexOf("model CodingWorkspaceLease {"));
    expect(leaseBlock).toMatch(/workspaceId\s+String\s+@unique/);
    expect(leaseBlock).toMatch(/@@map\("coding_workspace_leases"\)/);
  });

  it("the generated prisma client includes the new models", () => {
    expect(existsSync(join(dbDir, "generated", "prisma", "models", "CodingSession.ts"))).toBe(true);
    expect(
      existsSync(join(dbDir, "generated", "prisma", "models", "CodingWorkspaceLease.ts")),
    ).toBe(true);
  });
});
