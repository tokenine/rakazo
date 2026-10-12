"""One-shot S3 patch: declare both secret names in the sandbox secrets fixture."""
from pathlib import Path

path = Path("packages/adapters/src/process-sandbox-secrets.test.ts")
src = path.read_text()
old = '    requiredSecrets: ["github_token"],'
new = '    requiredSecrets: ["github_token", "npm_token"],'
assert old in src
path.write_text(src.replace(old, new, 1))
print("fixture updated")
