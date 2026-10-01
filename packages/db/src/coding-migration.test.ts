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
 *
 * S3 (fix round r1): slice 3 added three more coding migrations — per-project
 * encrypted secrets (T14), the session audit-head checkpoint (T18), and
 * durable secret grants (T15). They are registered here in timestamp order so
 * the ordering gate classifies them as coding migrations too.
 */
const CODING_MIGRATIONS = [
  "20261001050500_coding_sessions_lease",
  "20261002000000_coding_session_latest_run_idx",
  "20261002030000_coding_project_secrets",
  "20261002031000_coding_session_secrets_audit_head",
  "20261002032000_coding_secret_grants",
] as const;

function migrationSql(name: string): string {
  return readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
}

/** Comment-stripped, semicolon-split SQL statements of one migration. */
function statementsOf(name: string): string[] {
  return migrationSql(name)
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * Existing tables before the coding migrations (from schema.prisma @@map
 * names). The four coding tables are NEW — every other mapped table must
 * predate the coding migrations and stay untouched by them.
 */
function existingMappedTables(): Set<string> {
  const maps = [...schemaSql.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]!);
  return new Set(
    maps.filter(
      (name) =>
        ![
          "coding_sessions",
          "coding_workspace_leases",
          "coding_project_secrets",
          "coding_secret_grants",
        ].includes(name),
    ),
  );
}

const NEW_TABLES = new Set([
  "coding_sessions",
  "coding_workspace_leases",
  "coding_project_secrets",
  "coding_secret_grants",
]);

describe("coding migrations are additive (V14, T1)", () => {
  it("every coding migration is additive — new tables/indexes plus nullable column adds only; no drops, renames, or rewrites", () => {
    for (const name of CODING_MIGRATIONS) {
      const statements = statementsOf(name);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        const isCreate = /^CREATE (TABLE|UNIQUE INDEX|INDEX)\b/.test(statement);
        // S3 (T18) adds one nullable checkpoint column on a coding table via
        // ALTER TABLE — the only non-CREATE form an additive coding migration
        // may take: no default, no constraint, no rewrite of existing rows.
        const alterMatch =
          /^ALTER TABLE "([A-Za-z_][A-Za-z0-9_]*)" ADD COLUMN "([A-Za-z][A-Za-z0-9_]*)"/.exec(
            statement,
          );
        const isAdditiveColumnAdd =
          alterMatch !== null &&
          NEW_TABLES.has(alterMatch[1]!) &&
          !/\b(DROP|RENAME|TRUNCATE|UPDATE|DELETE|INSERT|ALTER COLUMN|CONSTRAINT|REFERENCES|NOT NULL|SET|USING)\b/i.test(
            statement,
          );
        expect(isCreate || isAdditiveColumnAdd).toBe(true);
        expect(statement).not.toMatch(/\b(DROP|RENAME|TRUNCATE|UPDATE|DELETE|INSERT)\b/i);
      }
    }
  });

  it("every coding migration touches only the new coding tables — existing tables are untouched", () => {
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

  it("the S3 secrets migrations contain exactly their declared additive statements", () => {
    // T14: per-project encrypted secrets — one new table plus its two indexes.
    const projectSecrets = statementsOf("20261002030000_coding_project_secrets");
    expect(projectSecrets).toHaveLength(3);
    expect(projectSecrets[0]).toMatch(/^CREATE TABLE "coding_project_secrets" \(/);
    expect(projectSecrets[0]).toMatch(/"ciphertext" TEXT NOT NULL/);
    expect(projectSecrets[0]).toMatch(
      /"rotatedAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/,
    );
    expect(projectSecrets[1]).toMatch(
      /CREATE UNIQUE INDEX "coding_project_secrets_workspaceId_name_key" ON "coding_project_secrets"\("workspaceId", "name"\)/,
    );
    expect(projectSecrets[2]).toMatch(
      /CREATE INDEX "coding_project_secrets_workspaceId_idx" ON "coding_project_secrets"\("workspaceId"\)/,
    );

    // T18: audit-chain head checkpoint — exactly one nullable JSONB column add
    // on the coding session, and the schema declares it nullable too.
    const auditHead = statementsOf("20261002031000_coding_session_secrets_audit_head");
    expect(auditHead).toEqual([
      'ALTER TABLE "coding_sessions" ADD COLUMN "secretsAuditHead" JSONB',
    ]);
    const sessionBlock = schemaSql.slice(
      schemaSql.indexOf("model CodingSession {"),
      schemaSql.indexOf("model CodingWorkspaceLease {"),
    );
    expect(sessionBlock).toMatch(/secretsAuditHead\s+Json\?/);

    // T15: durable secret grants — one new table plus its two indexes.
    const grants = statementsOf("20261002032000_coding_secret_grants");
    expect(grants).toHaveLength(3);
    expect(grants[0]).toMatch(/^CREATE TABLE "coding_secret_grants" \(/);
    expect(grants[0]).toMatch(/"secretRef" TEXT NOT NULL/);
    expect(grants[0]).toMatch(/"revokedAt" TIMESTAMP\(3\)/);
    expect(grants[1]).toMatch(
      /CREATE UNIQUE INDEX "coding_secret_grants_workspaceId_taskRunId_secretName_key" ON "coding_secret_grants"\("workspaceId", "taskRunId", "secretName"\)/,
    );
    expect(grants[2]).toMatch(
      /CREATE INDEX "coding_secret_grants_workspaceId_taskRunId_idx" ON "coding_secret_grants"\("workspaceId", "taskRunId"\)/,
    );
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
