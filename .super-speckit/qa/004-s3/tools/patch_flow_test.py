"""One-shot S3 patch: flow test passes sessionId to revoke so the run-record head tracks it."""
from pathlib import Path

path = Path("packages/adapters/src/coding-secrets-flow.test.ts")
src = path.read_text()
old = """    const revoke = await grants.revokeGrant({
      workspaceId,
      taskRunId,
      botId: "bot-flow",
      actor: "user",
      force: true,"""
new = """    const revoke = await grants.revokeGrant({
      workspaceId,
      taskRunId,
      botId: "bot-flow",
      actor: "user",
      sessionId: "session-flow",
      force: true,"""
assert old in src
path.write_text(src.replace(old, new, 1))
print("flow test updated")
