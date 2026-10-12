"""One-shot S3 patch: executor finish() is async — return its result."""
from pathlib import Path

path = Path("packages/adapters/src/executor.ts")
src = path.read_text()
old = """            if (codingEgressValues.length > 0) {
              const egress = new SecretEgressFilter([...runSecrets, ...codingEgressValues]);
              finish(egress.filterCommandResult(result));
            } else {
              finish(redactAgentCommandResult(result, runSecrets));
            }
            return;"""
new = """            if (codingEgressValues.length > 0) {
              const egress = new SecretEgressFilter([...runSecrets, ...codingEgressValues]);
              return finish(egress.filterCommandResult(result));
            }
            return finish(redactAgentCommandResult(result, runSecrets));"""
assert old in src
path.write_text(src.replace(old, new, 1))
print("finish fixed")
