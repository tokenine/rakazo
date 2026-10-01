/**
 * 004-code-mode S3 (T18, V10) — tamper-evident secrets audit chain (Q10).
 *
 * Append-only JSONL at a per-workspace path; one line per event:
 *   {seq, ts, actor, botId, workspaceId, taskRunId, secretName, secretRef,
 *    mechanism, ttl, grantRef, prevHash, hash}
 * with hash = sha256(prev_hash + canonical_entry_json), genesis prev hash
 * = SECRETS_AUDIT_GENESIS_HASH. Entries carry NAMES and value-free refs —
 * never secret material (the name grammar is enforced on append).
 *
 * `verifySecretsAuditChain` recomputes the whole chain and detects ANY
 * tampering: edited fields, deleted/reordered/spliced entries, seq breaks,
 * corrupted lines, and a recomputed head that disagrees with the head
 * checkpointed to the run record (CodingSession.secretsAuditHead —
 * wholesale-log-replacement detection).
 *
 * Append-only is enforced at the write path (append-only file opens); under
 * the D-Q9 trusted-code threat model tamper-evidence is DETECTION — the
 * same-UID task could rewrite the file, and the verifier + run-record head
 * exist precisely to catch that.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { PrismaClient } from "@rakazo/db";
import { isValidProjectSecretName } from "./coding-project-secrets.js";

export const SECRETS_AUDIT_GENESIS_HASH = "0".repeat(64);

export const SECRETS_AUDIT_MECHANISMS = [
  "grant",
  "inject",
  "revoke",
  "revoke-force",
  "expire",
  "rotate",
  "stale",
] as const;

export type SecretsAuditMechanism = (typeof SECRETS_AUDIT_MECHANISMS)[number];

/** The canonical entry: this exact key order is the hash input. */
export interface SecretsAuditEntry {
  seq: number;
  ts: string;
  actor: string;
  botId: string;
  workspaceId: string;
  taskRunId: string;
  secretName: string;
  /** Value-free reference (coding-project-secret:<id> or the grant ref). */
  secretRef: string;
  mechanism: SecretsAuditMechanism | string;
  /** Grant TTL in seconds (600 = the ratified 10-minute v1 default). */
  ttl: number;
  grantRef: string;
}

export interface SealedAuditEntry extends SecretsAuditEntry {
  prevHash: string;
  hash: string;
}

export interface SecretsAuditHead {
  seq: number;
  hash: string;
  at?: string;
}

export interface SecretsAuditVerifyResult {
  ok: boolean;
  entries: SealedAuditEntry[];
  head: SecretsAuditHead | null;
  brokenAt?: { seq: number; reason: string };
}

function canonicalJson(entryData: SecretsAuditEntry): string {
  return JSON.stringify({
    seq: entryData.seq,
    ts: entryData.ts,
    actor: entryData.actor,
    botId: entryData.botId,
    workspaceId: entryData.workspaceId,
    taskRunId: entryData.taskRunId,
    secretName: entryData.secretName,
    secretRef: entryData.secretRef,
    mechanism: entryData.mechanism,
    ttl: entryData.ttl,
    grantRef: entryData.grantRef,
  });
}

function entryHash(prevHash: string, entryData: SecretsAuditEntry): string {
  return createHash("sha256")
    .update(prevHash + canonicalJson(entryData))
    .digest("hex");
}

async function readLines(file: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const text = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  return text.length === 0 ? [] : text.split("\n");
}

export async function appendSecretsAudit(
  deps: { file: string },
  entryData: SecretsAuditEntry,
): Promise<{ seq: number; hash: string; prevHash: string; entry: SecretsAuditEntry }> {
  if (!isValidProjectSecretName(entryData.secretName)) {
    throw new Error(
      `Invalid audit entry: secretName ${JSON.stringify(entryData.secretName)} is not a project secret name`,
    );
  }
  if (entryData.seq < 1 || !Number.isInteger(entryData.seq)) {
    throw new Error("Invalid audit entry: seq must be a positive integer");
  }
  const lines = await readLines(deps.file);
  let prevHash = SECRETS_AUDIT_GENESIS_HASH;
  let prevSeq = 0;
  if (lines.length > 0) {
    const last = JSON.parse(lines[lines.length - 1]!) as SealedAuditEntry;
    prevHash = last.hash;
    prevSeq = last.seq;
  }
  if (entryData.seq !== prevSeq + 1) {
    throw new Error(`Invalid audit entry: expected seq ${prevSeq + 1}, got ${entryData.seq}`);
  }
  const hash = entryHash(prevHash, entryData);
  const sealed: SealedAuditEntry = { ...entryData, prevHash, hash };
  // Append-only write path: a single line append, no in-place edits.
  await writeFile(deps.file, `${JSON.stringify(sealed)}\n`, { flag: "a", encoding: "utf8" });
  return { seq: sealed.seq, hash, prevHash, entry: entryData };
}

export async function verifySecretsAuditChain(deps: {
  file: string;
  expectedHead?: SecretsAuditHead | null;
}): Promise<SecretsAuditVerifyResult> {
  const lines = await readLines(deps.file);
  const entries: SealedAuditEntry[] = [];
  let prevHash = SECRETS_AUDIT_GENESIS_HASH;
  for (let index = 0; index < lines.length; index += 1) {
    let parsed: SealedAuditEntry;
    try {
      parsed = JSON.parse(lines[index]!) as SealedAuditEntry;
    } catch {
      return {
        ok: false,
        entries,
        head: entries.at(-1) ?? null,
        brokenAt: { seq: index + 1, reason: "line does not parse as a JSONL audit entry" },
      };
    }
    if (parsed.prevHash !== prevHash) {
      return {
        ok: false,
        entries,
        head: entries.at(-1) ?? null,
        brokenAt: {
          seq: parsed.seq,
          reason: "prevHash does not chain to the previous entry (tamper/splice)",
        },
      };
    }
    if (parsed.seq !== index + 1) {
      return {
        ok: false,
        entries,
        head: entries.at(-1) ?? null,
        brokenAt: { seq: parsed.seq, reason: "seq continuity broken (deleted or reordered entry)" },
      };
    }
    if (entryHash(prevHash, parsed) !== parsed.hash) {
      return {
        ok: false,
        entries,
        head: entries.at(-1) ?? null,
        brokenAt: {
          seq: parsed.seq,
          reason: "entry hash mismatch — entry was tampered with after sealing",
        },
      };
    }
    prevHash = parsed.hash;
    entries.push(parsed);
  }
  const head = entries.at(-1) ?? null;
  if (deps.expectedHead) {
    const matches =
      head !== null && head.seq === deps.expectedHead.seq && head.hash === deps.expectedHead.hash;
    if (!matches) {
      return {
        ok: false,
        entries,
        head,
        brokenAt: {
          seq: head?.seq ?? 0,
          reason:
            "recomputed chain head does not match the head checkpointed to the run record — the log may have been replaced or truncated wholesale",
        },
      };
    }
  }
  return { ok: true, entries, head };
}

/** Checkpoints the chain head onto the run record (CodingSession row). */
export async function checkpointSecretsAuditHead(deps: {
  prisma: PrismaClient;
  sessionId: string;
  head: SecretsAuditHead;
}): Promise<void> {
  await deps.prisma.codingSession.update({
    where: { id: deps.sessionId },
    data: {
      secretsAuditHead: { seq: deps.head.seq, hash: deps.head.hash, at: new Date().toISOString() },
    },
  });
}

export function auditHeadMatches(
  checkpoint: { seq: number; hash: string } | null | undefined,
  head: SecretsAuditHead,
): boolean {
  return (
    checkpoint !== null &&
    checkpoint !== undefined &&
    checkpoint.seq === head.seq &&
    checkpoint.hash === head.hash
  );
}
