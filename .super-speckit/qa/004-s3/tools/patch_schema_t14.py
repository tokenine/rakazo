"""One-shot S3 schema patch (T14): append the CodingProjectSecret model.

Run once; asserts the anchor so it cannot double-apply.
"""
from pathlib import Path

path = Path("packages/db/prisma/schema.prisma")
src = path.read_text()

anchor = """/// 004-code-mode: exclusive per-workspace lease. A second coding session
/// cannot attach while the lease is held; expired leases are taken over with
/// a bumped fence (never last-writer-wins on an active workspace).
model CodingWorkspaceLease {"""
assert anchor in src, "anchor missing"
assert "model CodingProjectSecret" not in src, "already applied"

addition = """/// 004-code-mode S3 (T14, Q10 Option B): per-project (per coding workspace)
/// encrypted secrets. Values are sealed with the deployment EncryptedSecretStore
/// (the docs/bot-secrets.md facility's AES-256-GCM primitive) — the same
/// at-rest encryption the bot_secrets table uses — but scoped per workspace,
/// because BotSecret itself is (user, space, bot)-keyed and
/// HTTP-destination-shaped and cannot hold project secrets. Plaintexts never
/// leave the grant/injection path; rows carry ciphertext and metadata only.
model CodingProjectSecret {
  id          String   @id
  workspaceId String
  name        String
  ciphertext  String
  rotatedAt   DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([workspaceId, name])
  @@index([workspaceId])
  @@map("coding_project_secrets")
}

""" + anchor

path.write_text(src.replace(anchor, addition, 1))
print("schema updated")
