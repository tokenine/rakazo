"""One-shot S3 patch (T21): doctor delegates to the shared secretsRuntimeSupport predicate."""
from pathlib import Path

path = Path("packages/adapters/src/coding-doctor.ts")
src = path.read_text()

# 1. import
old = """import { DEFAULT_LEASE_TTL_MS } from "./coding-session-service.js";"""
new = """import { secretsRuntimeSupport } from "./coding-secret-grants.js";
import { DEFAULT_LEASE_TTL_MS } from "./coding-session-service.js";"""
assert old in src, "import anchor missing"
src = src.replace(old, new, 1)

# 2. delegate (D-Q10 item 6): single predicate, disclosure both directions
old = """/**
 * Secrets-state disclosure (D-Q10 item 6). ON only when the driver owns the
 * spawn boundary so injection can be guaranteed at process spawn/bootstrap
 * env; OFF with an explicit reason otherwise — fail closed, never silent.
 */
export function codeModeSecretsState(driverKind: string): CodeModeSecretsState {
  if (driverKind === CODE_MODE_DRIVER_KIND) {
    return {
      state: "ON",
      reason:
        "driver 'process' owns the spawn boundary; injection happens at process spawn/bootstrap env only (D-Q10 §2), so the injection guarantee holds",
    };
  }
  return {
    state: "OFF",
    reason: `driver '${driverKind || "none"}' does not own the spawn boundary, so a spawn-env injection cannot be guaranteed; secrets features fail closed (D-Q10 §6)`,
  };
}"""
new = """/**
 * Secrets-state disclosure (D-Q10 item 6). DELEGATES to the SAME predicate
 * the runtime grants gate uses (coding-secret-grants.ts
 * secretsRuntimeSupport) so the doctor and the fail-closed runtime guard can
 * never drift: ON only when the driver owns the spawn boundary so injection
 * can be guaranteed at process spawn/bootstrap env; OFF with an explicit
 * reason otherwise. The confidentiality-bounded-by-threat-model note rides
 * the reason in BOTH directions — fail closed, never silent, either way.
 */
export function codeModeSecretsState(driverKind: string): CodeModeSecretsState {
  const support = secretsRuntimeSupport(driverKind);
  return { state: support.enabled ? "ON" : "OFF", reason: support.disclosure };
}"""
assert old in src, "predicate anchor missing"
src = src.replace(old, new, 1)

path.write_text(src)
print("doctor delegated")
