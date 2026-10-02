/**
 * 004-code-mode S3 (T14, Q10 Option B) — per-project encrypted secrets store.
 *
 * Reuses the existing credential-storage primitives (the docs/bot-secrets.md
 * facility): values are sealed with the deployment's EncryptedSecretStore
 * (AES-256-GCM, record-bound AAD) — the exact primitive behind the
 * `bot_secrets` table. The bot_secrets SCHEMA itself is
 * (user, space, bot, name)-keyed and HTTP-destination-shaped, so it cannot
 * hold project secrets (verified against packages/db/prisma/schema.prisma
 * before building this); `coding_project_secrets` is the project-scoped
 * (per coding workspace) variant over the same encryption primitive.
 *
 * Boundaries:
 * - Rows carry ciphertext + rotation metadata only; plaintexts exist in
 *   memory only for the grant/injection path (getDecrypted).
 * - Names reuse the BotSecretName grammar (`^[a-z][a-z0-9_]{0,63}$`), which
 *   structurally excludes wildcards for v1 (T15).
 * - Rotation is a re-set: the ciphertext is replaced and rotatedAt advances,
 *   which is what marks older grants stale at their next start (T19).
 * - The per-workspace ceiling matches bot_secrets (100).
 */

import { randomBytes } from "node:crypto";
import type { EncryptedSecretStore } from "./secrets.js";


export const MAX_PROJECT_SECRETS_PER_WORKSPACE = 100;
export const MAX_PROJECT_SECRET_LENGTH = 16_384;

export class ProjectSecretNameInvalidError extends Error {
  constructor(name: string) {
    super(
      `Invalid project secret name ${JSON.stringify(name)}: expected lowercase letters, digits and underscores (no wildcards).`,
    );
    this.name = "ProjectSecretNameInvalidError";
  }
}

export class ProjectSecretNotFoundError extends Error {
  constructor(workspaceId: string, name: string) {
    super(`No project secret named ${JSON.stringify(name)} exists for workspace ${workspaceId}.`);
    this.name = "ProjectSecretNotFoundError";
  }
}

export class ProjectSecretLimitError extends Error {
  constructor(workspaceId: string) {
    super(
      `Project secret limit (${MAX_PROJECT_SECRETS_PER_WORKSPACE}) reached for workspace ${workspaceId}.`,
    );
    this.name = "ProjectSecretLimitError";
  }
}

export interface ProjectSecretRow {
  id: string;
  workspaceId: string;
  name: string;
  ciphertext: string;
  rotatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** The prisma surface this store uses (also the fake-double contract). */
export interface ProjectSecretsClient {
  codingProjectSecret: {
    create(args: { data: ProjectSecretRow }): Promise<ProjectSecretRow>;
    findUnique(args: {
      where: { workspaceId_name: { workspaceId: string; name: string } };
    }): Promise<ProjectSecretRow | null>;
    findMany(args: { where: { workspaceId: string } }): Promise<ProjectSecretRow[]>;
    update(args: {
      where: { id: string };
      data: Partial<ProjectSecretRow>;
    }): Promise<ProjectSecretRow>;
    deleteMany(args: { where: { workspaceId: string; name: string } }): Promise<{ count: number }>;
    count(args: { where: { workspaceId: string } }): Promise<number>;
  };
}

/**
 * Project-secret names reuse the 004 v1 grammar (constant 2 of S3 EVIDENCE.md):
 * a strict subset of the mainline BotSecretName regex, with hyphens excluded so
 * names remain valid POSIX process-environment identifiers. Preserves V9's
 * "no wildcards, no dashes" pin against the mainline grammar that accepts
 * hyphens for display-only bot secrets.
 */
const PROJECT_SECRET_NAME = /^[a-z][a-z0-9_]{0,63}$/;
export function isValidProjectSecretName(name: string): boolean {
  return PROJECT_SECRET_NAME.test(name);
}

/** A stable, value-free reference for audit entries and grant records. */
export function projectSecretRef(id: string): string {
  return `coding-project-secret:${id}`;
}

export function parseProjectSecretRef(ref: string): string | null {
  const prefix = "coding-project-secret:";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

export interface ProjectSecretsStore {
  /** Stores or rotates a secret; returns rotation metadata, never values. */
  set(input: {
    workspaceId: string;
    name: string;
    plaintext: string;
    now?: () => Date;
  }): Promise<{ id: string; name: string; rotated: boolean; rotatedAt: Date }>;
  /** Decrypts for the grant/injection path ONLY. */
  getDecrypted(workspaceId: string, name: string): Promise<string>;
  listMetadata(workspaceId: string): Promise<Array<{ id: string; name: string; rotatedAt: Date }>>;
  listNames(workspaceId: string): Promise<string[]>;
  rotationOf(workspaceId: string, name: string): Promise<Date | null>;
  remove(workspaceId: string, name: string): Promise<void>;
}

export function createProjectSecretsStore(deps: {
  prisma: ProjectSecretsClient;
  secretStore: Pick<EncryptedSecretStore, "put" | "load">;
  now?: () => Date;
}): ProjectSecretsStore {
  const now = deps.now ?? (() => new Date());

  const rowFor = (workspaceId: string, name: string) =>
    deps.prisma.codingProjectSecret.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    });

  const set: ProjectSecretsStore["set"] = async (input) => {
    if (!isValidProjectSecretName(input.name)) {
      throw new ProjectSecretNameInvalidError(input.name);
    }
    if (!input.plaintext || input.plaintext.length > MAX_PROJECT_SECRET_LENGTH) {
      throw new Error("Invalid project secret length");
    }
    const at = (input.now ?? now)();
    const existing = await rowFor(input.workspaceId, input.name);
    if (existing) {
      const sealed = await deps.secretStore.put(
        input.plaintext,
        {
          operationId: existing.id,
          traceId: existing.id,
          signal: new AbortController().signal,
        } as never,
        existing.id,
      );
      await deps.prisma.codingProjectSecret.update({
        where: { id: existing.id },
        data: { ciphertext: sealed.ciphertext, rotatedAt: at },
      });
      return { id: existing.id, name: input.name, rotated: true, rotatedAt: at };
    }
    if (
      (await deps.prisma.codingProjectSecret.count({
        where: { workspaceId: input.workspaceId },
      })) >= MAX_PROJECT_SECRETS_PER_WORKSPACE
    ) {
      throw new ProjectSecretLimitError(input.workspaceId);
    }
    const id = randomBytes(12).toString("hex");
    const sealed = await deps.secretStore.put(
      input.plaintext,
      {
        operationId: id,
        traceId: id,
        signal: new AbortController().signal,
      } as never,
      id,
    );
    await deps.prisma.codingProjectSecret.create({
      data: {
        id,
        workspaceId: input.workspaceId,
        name: input.name,
        ciphertext: sealed.ciphertext,
        rotatedAt: at,
        createdAt: at,
        updatedAt: at,
      },
    });
    return { id, name: input.name, rotated: false, rotatedAt: at };
  };

  const getDecrypted: ProjectSecretsStore["getDecrypted"] = async (workspaceId, name) => {
    if (!isValidProjectSecretName(name)) throw new ProjectSecretNameInvalidError(name);
    const row = await rowFor(workspaceId, name);
    if (!row) throw new ProjectSecretNotFoundError(workspaceId, name);
    return deps.secretStore.load(row.ciphertext, row.id);
  };

  const listMetadata: ProjectSecretsStore["listMetadata"] = async (workspaceId) => {
    const rows = await deps.prisma.codingProjectSecret.findMany({ where: { workspaceId } });
    return rows.map((row) => ({ id: row.id, name: row.name, rotatedAt: row.rotatedAt }));
  };

  const remove: ProjectSecretsStore["remove"] = async (workspaceId, name) => {
    await deps.prisma.codingProjectSecret.deleteMany({ where: { workspaceId, name } });
  };

  return {
    set,
    getDecrypted,
    listMetadata,
    listNames: async (workspaceId) =>
      (await listMetadata(workspaceId)).map((entry) => entry.name).sort(),
    rotationOf: async (workspaceId, name) => {
      if (!isValidProjectSecretName(name)) throw new ProjectSecretNameInvalidError(name);
      const row = await rowFor(workspaceId, name);
      return row ? row.rotatedAt : null;
    },
    remove,
  };
}
