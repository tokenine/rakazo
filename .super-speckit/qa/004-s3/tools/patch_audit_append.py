"""One-shot S3 audit patch 2: include prevHash in the append result."""
from pathlib import Path

path = Path("packages/adapters/src/coding-secrets-audit.ts")
src = path.read_text()

old = """export async function appendSecretsAudit(
  deps: { file: string },
  entryData: SecretsAuditEntry,
): Promise<{ seq: number; hash: string; entry: SecretsAuditEntry }> {"""
new = """export async function appendSecretsAudit(
  deps: { file: string },
  entryData: SecretsAuditEntry,
): Promise<{ seq: number; hash: string; prevHash: string; entry: SecretsAuditEntry }> {"""
assert old in src, "anchor not found"

old2 = """  return { seq: sealed.seq, hash, entry: entryData };"""
new2 = """  return { seq: sealed.seq, hash, prevHash, entry: entryData };"""
assert old2 in src, "anchor 2 not found"

path.write_text(src.replace(old, new, 1).replace(old2, new2, 1))
print("append result patched")
