import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dbDir = dirname(fileURLToPath(import.meta.url));
const prismaDir = join(dbDir, "..", "prisma");
const migrationsDir = join(prismaDir, "migrations");
const migrationName = "20261001050500_coding_sessions_lease";
const migrationSql = readFileSync(join(migrationsDir, migrationName, "migration.sql"), "utf8");
const schemaSql = readFileSync(join(prismaDir, "schema.prisma"), "utf8");

/** Existing tables before the coding migration (from schema.prisma @@map names). */
function existingMappedTables(): Set<string> {
  const maps = [...schemaSql.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]!);
  return new Set(
    maps.filter((name) => !["coding_sessions", "coding_workspace_leases"].includes(name)),
  );
}

const NEW_TABLES = new Set(["coding_sessions", "coding_workspace_leases"]);

describe("coding_sessions_lease migration is additive (V14, T1)", () => {
  it("only creates new tables and indexes — no drops, alters, renames, or rewrites", () => {
    const statements = migrationSql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX)\b/);
      expect(statement).not.toMatch(/\b(DROP|ALTER|RENAME|TRUNCATE|UPDATE|DELETE|INSERT)\b/i);
    }
  });

  it("touches only the two new coding tables — existing tables are untouched", () => {
    const existing = existingMappedTables();
    const referenced = new Set<string>();
    for (const match of migrationSql.matchAll(
      /(?:TABLE|INDEX)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*(?:\(|ON)/gi,
    )) {
      referenced.add(match[1]!);
    }
    for (const match of migrationSql.matchAll(/CREATE TABLE "([^"]+)"/gi)) {
      referenced.add(match[1]!);
    }
    for (const table of referenced) {
      expect(NEW_TABLES.has(table) || !existing.has(table)).toBe(true);
      expect(existing.has(table)).toBe(false);
    }
  });

  it("is ordered after every existing migration (timestamp-named directory)", () => {
    const all = readdirSync(migrationsDir).filter(
      (name) => /^\d{14}_/.test(name) && name !== migrationName,
    );
    for (const other of all) {
      expect(migrationName > other).toBe(true);
    }
    expect(existsSync(join(migrationsDir, migrationName, "migration.sql"))).toBe(true);
  });

  it("the schema declares the session bound to (workspaceId, engine) and the lease table", () => {
    expect(schemaSql).toMatch(/model CodingSession \{/);
    expect(schemaSql).toMatch(/model CodingWorkspaceLease \{/);
    const sessionBlock = schemaSql.slice(
      schemaSql.indexOf("model CodingSession {"),
      schemaSql.indexOf("model CodingWorkspaceLease {"),
    );
    expect(sessionBlock).toMatch(/workspaceId\s+String/);
    expect(sessionBlock).toMatch(/engine\s+String/);
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
