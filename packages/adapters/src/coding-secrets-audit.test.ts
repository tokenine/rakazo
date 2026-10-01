import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSecretsAudit,
  auditHeadMatches,
  checkpointSecretsAuditHead,
  SECRETS_AUDIT_GENESIS_HASH,
  type SecretsAuditEntry,
  verifySecretsAuditChain,
} from "./coding-secrets-audit.js";

/**
 * 004-code-mode S3 (T18, V10) — tamper-evident secrets audit chain.
 *
 * Append-only JSONL: one entry per grant/inject/revoke/expire event, each
 * sealed with sha256(prev_hash + entry) so ANY tampering (field edit,
 * deletion, reordering, splice) breaks the chain and is reported by
 * `verifySecretsAuditChain`. The chain head is checkpointed to the run
 * record (CodingSession.secretsAuditHead) so a verifier can detect a
 * wholesale log replacement, not just in-file edits.
 *
 * The expected hashes here are computed INDEPENDENTLY (local sha256 over
 * the documented canonical form) — the test is an oracle, not a mirror of
 * the implementation.
 */

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function auditFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rakazo-s3-audit-"));
  dirs.push(dir);
  return path.join(dir, "secrets-audit.jsonl");
}

function entry(overrides: Partial<SecretsAuditEntry> = {}): SecretsAuditEntry {
  return {
    seq: 1,
    ts: "2026-10-02T06:00:00.000Z",
    actor: "user",
    botId: "bot-1",
    workspaceId: "ws-1",
    taskRunId: "run-1",
    secretName: "github_token",
    secretRef: "coding-project-secret:abc",
    mechanism: "grant",
    ttl: 600,
    grantRef: "grant-1",
    ...overrides,
  };
}

/** Independent oracle: the documented canonical hash. */
function expectedHash(prevHash: string, entryData: SecretsAuditEntry): string {
  return createHash("sha256")
    .update(prevHash + JSON.stringify(entryData))
    .digest("hex");
}

describe("secrets audit chain (T18, V10)", () => {
  it("appends entries with a sha256(prev_hash+entry) chain and contiguous seq", async () => {
    const file = await auditFile();
    const first = await appendSecretsAudit({ file }, entry({ seq: 1 }));
    const second = await appendSecretsAudit(
      { file },
      entry({ seq: 2, mechanism: "inject", actor: "system" }),
    );
    expect(first.hash).toBe(expectedHash(SECRETS_AUDIT_GENESIS_HASH, first.entry));
    expect(second.prevHash).toBe(first.hash);
    expect(second.hash).toBe(expectedHash(first.hash, second.entry));
    const raw = await readFile(file, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    for (const line of raw.trim().split("\n")) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      // The canonical entry fields carry no hash material of their own.
      expect(Object.keys(parsed).sort()).toEqual(
        [
          "actor",
          "botId",
          "grantRef",
          "hash",
          "mechanism",
          "prevHash",
          "secretName",
          "secretRef",
          "seq",
          "taskRunId",
          "ts",
          "ttl",
          "workspaceId",
        ].sort(),
      );
    }
  });

  it("verify recomputes the whole chain and accepts an intact log", async () => {
    const file = await auditFile();
    await appendSecretsAudit({ file }, entry({ seq: 1 }));
    await appendSecretsAudit({ file }, entry({ seq: 2, mechanism: "inject" }));
    await appendSecretsAudit({ file }, entry({ seq: 3, mechanism: "revoke" }));
    const result = await verifySecretsAuditChain({ file });
    expect(result.ok).toBe(true);
    expect(result.brokenAt).toBeUndefined();
    expect(result.entries).toHaveLength(3);
  });

  it("verify detects a tampered field on any entry (V10 tamper-detection)", async () => {
    const file = await auditFile();
    await appendSecretsAudit({ file }, entry({ seq: 1 }));
    await appendSecretsAudit({ file }, entry({ seq: 2, mechanism: "inject" }));
    const raw = await readFile(file, "utf8");
    const lines = raw.trim().split("\n");
    const tampered = lines[0]!.replace('"actor":"user"', '"actor":"attacker"');
    await writeFile(file, `${tampered}\n${lines[1]}\n`, "utf8");
    const result = await verifySecretsAuditChain({ file });
    expect(result.ok).toBe(false);
    expect(result.brokenAt?.seq).toBe(1);
    expect(result.brokenAt?.reason).toMatch(/hash|tamper/i);
  });

  it("verify detects deleted and reordered entries, and bad seq continuity", async () => {
    const file = await auditFile();
    await appendSecretsAudit({ file }, entry({ seq: 1 }));
    await appendSecretsAudit({ file }, entry({ seq: 2, mechanism: "inject" }));
    await appendSecretsAudit({ file }, entry({ seq: 3, mechanism: "revoke" }));
    const raw = await readFile(file, "utf8");
    const lines = raw.trim().split("\n");
    // Deletion of the middle entry breaks the second entry's prevHash.
    await writeFile(file, `${lines[0]}\n${lines[2]}\n`, "utf8");
    const deleted = await verifySecretsAuditChain({ file });
    expect(deleted.ok).toBe(false);
    expect(deleted.brokenAt?.seq).toBe(3);
    // Reordering likewise.
    await writeFile(file, `${lines[2]}\n${lines[0]}\n${lines[1]}\n`, "utf8");
    const reordered = await verifySecretsAuditChain({ file });
    expect(reordered.ok).toBe(false);
    // Seq continuity: seq must restart correctly after a truncation.
    await writeFile(file, `${lines[0]}\n`, "utf8");
    await appendSecretsAudit({ file }, entry({ seq: 2, mechanism: "inject" }));
    const extended = await verifySecretsAuditChain({ file });
    expect(extended.ok).toBe(true);
  });

  it("verify rejects a corrupted (non-JSON) line without throwing", async () => {
    const file = await auditFile();
    await appendSecretsAudit({ file }, entry({ seq: 1 }));
    const raw = await readFile(file, "utf8");
    await writeFile(file, `${raw}not-json\n`, "utf8");
    const result = await verifySecretsAuditChain({ file });
    expect(result.ok).toBe(false);
    expect(result.brokenAt?.reason).toMatch(/parse/i);
  });

  it("refuses entries whose secretName is not a valid project secret name", async () => {
    const file = await auditFile();
    await expect(appendSecretsAudit({ file }, entry({ secretName: "*" }))).rejects.toThrow(/name/i);
  });

  it("checkpoints the chain head to the run record and detects a mismatch", async () => {
    const file = await auditFile();
    const head = await appendSecretsAudit({ file }, entry({ seq: 1 }));
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      codingSession: {
        update: async (args: { where: { id: string }; data: unknown }) => {
          updates.push(args as Record<string, unknown>);
          return {};
        },
      },
    };
    await checkpointSecretsAuditHead({
      prisma: prisma as never,
      sessionId: "session-1",
      head: { seq: head.seq, hash: head.hash },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      where: { id: "session-1" },
      data: { secretsAuditHead: { seq: 1, hash: head.hash } },
    });
    expect(auditHeadMatches({ seq: 1, hash: head.hash }, head)).toBe(true);
    expect(auditHeadMatches({ seq: 1, hash: "different" }, head)).toBe(false);
    expect(auditHeadMatches(null, head)).toBe(false);
  });

  it("verify compares the recomputed head against the checkpointed head", async () => {
    const file = await auditFile();
    const head = await appendSecretsAudit({ file }, entry({ seq: 1 }));
    const intact = await verifySecretsAuditChain({
      file,
      expectedHead: { seq: head.seq, hash: head.hash },
    });
    expect(intact.ok).toBe(true);
    const lying = await verifySecretsAuditChain({
      file,
      expectedHead: { seq: 99, hash: "0".repeat(64) },
    });
    expect(lying.ok).toBe(false);
    expect(lying.brokenAt?.reason).toMatch(/head/i);
  });
});
