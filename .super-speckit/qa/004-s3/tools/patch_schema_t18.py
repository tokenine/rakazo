"""One-shot S3 schema patch (T18): additive secretsAuditHead column on CodingSession."""
from pathlib import Path

path = Path("packages/db/prisma/schema.prisma")
src = path.read_text()

anchor = """  /// Continuation provenance (V15): prior session id, engine-change label, handoff text.
  continuationOf    String?"""
assert anchor in src, "anchor missing"
assert "secretsAuditHead" not in src, "already applied"

addition = """  /// 004-code-mode S3 (T18): checkpointed secrets audit-chain head
  /// {seq, hash, at} — the run-record side of the audit verify comparison.
  secretsAuditHead  Json?
""" + anchor

path.write_text(src.replace(anchor, addition, 1))
print("schema updated")
