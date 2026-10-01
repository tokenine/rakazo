"""One-shot S3 patch: executor.ts T17 wiring (transform-aware for coding sessions)."""
from pathlib import Path

path = Path("packages/adapters/src/executor.ts")
src = path.read_text()

# 1. dep interface
old = """  /** 004-code-mode: coding acceptance gate. Present only for coding-session runs. */
  codingGate?: CodingAcceptanceGate;"""
new = """  /** 004-code-mode: coding acceptance gate. Present only for coding-session runs. */
  codingGate?: CodingAcceptanceGate;
  /**
   * 004-code-mode S3 (T17): granted-secret egress values for the run, when
   * the run belongs to a coding session with an active secrets grant. Shell
   * command results for coding sessions are redacted with the TRANSFORM-AWARE
   * deny-list filter (literal + base64/hex/URL); non-coding runs keep the
   * legacy literal-only behavior (scoped replacement per the task).
   */
  codingSecrets?: { egressValuesForRun(runId: string): string[] };"""
assert old in src, "deps anchor missing"
src = src.replace(old, new, 1)

# 2. import the filter
old = """import { CODING_SESSION_TRIGGER } from "./coding-pi-adapter.js";"""
new = """import { CODING_SESSION_TRIGGER } from "./coding-pi-adapter.js";
import { SecretEgressFilter } from "./coding-secrets-egress.js";"""
assert old in src, "import anchor missing"
src = src.replace(old, new, 1)

# 3. the shell finish (the literal-only redaction site T17 replaces)
old = """            return finish(redactAgentCommandResult(result, runSecrets));"""
new = """            // 004-code-mode S3 (T17): coding sessions redact with the
            // transform-aware egress filter over run secrets PLUS granted
            // secrets; non-coding runs keep the legacy literal-only form.
            const codingEgressValues =
              run.trigger === CODING_SESSION_TRIGGER
                ? (deps.codingSecrets?.egressValuesForRun(runId) ?? [])
                : [];
            if (codingEgressValues.length > 0) {
              const egress = new SecretEgressFilter([...runSecrets, ...codingEgressValues]);
              finish(egress.filterCommandResult(result));
            } else {
              finish(redactAgentCommandResult(result, runSecrets));
            }
            return;"""
assert src.count(old) == 1, f"shell finish anchor count = {src.count(old)}"
src = src.replace(old, new, 1)

path.write_text(src)
print("executor patched")
