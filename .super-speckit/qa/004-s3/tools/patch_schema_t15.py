"""One-shot S3 schema patch (T15): CodingSecretGrant table."""
from pathlib import Path

path = Path("packages/db/prisma/schema.prisma")
src = path.read_text()

anchor = """  @@unique([workspaceId, name])
  @@index([workspaceId])
  @@map("coding_project_secrets")
}"""
assert anchor in src, "anchor missing"
assert "model CodingSecretGrant" not in src, "already applied"

addition = anchor + """

/// 004-code-mode S3 (T15, Q10): secret grants per (workspace, taskRun).
/// A task config declares required secret NAMES before start (same gate
/// family as the T4 acceptance gate: deny-by-default); only granted,
/// unexpired, unrevoked, non-stale names resolve at injection. TTL and
/// revocation must survive restarts, so grant state is durable here.
model CodingSecretGrant {
  id          String    @id
  workspaceId String
  taskRunId   String
  secretName  String
  secretRef   String
  grantRef    String
  grantedAt   DateTime
  expiresAt   DateTime
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([workspaceId, taskRunId, secretName])
  @@index([workspaceId, taskRunId])
  @@map("coding_secret_grants")
}"""

path.write_text(src.replace(anchor, addition, 1))
print("schema updated")
