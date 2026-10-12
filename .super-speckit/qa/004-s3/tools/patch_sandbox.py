"""One-shot S3 patch: process-sandbox T16 + the LOW-7 binding constraint.

Four surgical replacements:
1. ProcessTaskSetupDefinition gains requiredSecrets (declared secret names).
2. ProcessTaskContext gains declaredSecretNames / grantedSecretEnv /
   secretGrantRef; the grant channel is a separate, capability-gated field.
3. createTaskContext validates the declared names and seeds the new fields.
4. execute() screens request.env BEFORE spawning and composes the child env
   so granted secrets enter OUTSIDE scrubProcessEnv's declared-vars argument.
Plus: the pure screenCommandEnv helper + applySecretGrant/clearSecretGrant.
"""
from pathlib import Path

path = Path("packages/adapters/src/process-sandbox.ts")
src = path.read_text()

# --- 1. setup definition -----------------------------------------------------
old = """export interface ProcessTaskSetupDefinition {
  taskId: string;
  /** Declared task-config env vars — the only extras that pass the scrub. */
  env?: Record<string, string>;
  /** Resource-limit overrides; unspecified keys fall back to the defaults. */
  limits?: Partial<ProcessTaskLimits>;
}"""
new = """export interface ProcessTaskSetupDefinition {
  taskId: string;
  /** Declared task-config env vars — the only extras that pass the scrub. */
  env?: Record<string, string>;
  /** Resource-limit overrides; unspecified keys fall back to the defaults. */
  limits?: Partial<ProcessTaskLimits>;
  /**
   * S3 (T15): the task config's declared secret NAMES (values arrive only
   * through the audited grant channel). Declaration alone closes the
   * per-command env channel for these names (LOW-7 binding constraint).
   */
  requiredSecrets?: string[];
}

/** Where a per-command env entry may be refused (LOW-7 screening). */
export type CommandEnvScreen =
  | { ok: true; env: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Values at least this long are checked for grant-value collisions under
 * other names; shorter granted values only gate their own names (a 3-char
 * value would false-positive every string containing it).
 */
const GRANT_VALUE_COLLISION_MIN_LENGTH = 8;

/**
 * S3 (LOW-7 binding constraint): screens the per-command request.env against
 * the task's grant-gated names and values. A name match (case-insensitive)
 * or a value carrying a granted secret refuses the WHOLE command — fail
 * closed with an explicit reason, never a silent strip and never a
 * downgraded run. Everything else passes through unchanged.
 */
export function screenCommandEnv(
  requestEnv: Record<string, string> | undefined,
  task: Pick<ProcessTaskContext, "declaredSecretNames" | "grantedSecretEnv">,
): CommandEnvScreen {
  if (!requestEnv || Object.keys(requestEnv).length === 0) return { ok: true, env: {} };
  const declaredLower = new Set(
    [...task.declaredSecretNames].map((name) => name.toLowerCase()),
  );
  const grantedValues = Object.values(task.grantedSecretEnv).filter(
    (value) => value.length >= GRANT_VALUE_COLLISION_MIN_LENGTH,
  );
  for (const [key, value] of Object.entries(requestEnv)) {
    if (declaredLower.has(key.toLowerCase())) {
      return {
        ok: false,
        reason:
          `command refused: request.env key "${key}" is a grant-gated secret name for this task; ` +
          "secrets reach the command environment ONLY through the audited grant channel at spawn " +
          "(no per-command override, no re-injection without grant + audit)",
      };
    }
    for (const granted of grantedValues) {
      if (value.includes(granted)) {
        return {
          ok: false,
          reason:
            `command refused: request.env value under "${key}" carries a granted secret value; ` +
            "grant-gated values cannot be re-injected through the per-command environment " +
            "(no per-command override, no re-injection without grant + audit)",
        };
      }
    }
  }
  return { ok: true, env: { ...requestEnv } };
}"""
assert old in src, "anchor 1"
src = src.replace(old, new, 1)

# --- 2. task context ---------------------------------------------------------
old = """export interface ProcessTaskContext {
  taskId: string;
  ref: ComputerRef;
  workspaceDir: string;
  dataDir: string;
  processGroupName: string;
  limits: ProcessTaskLimits;
  env: Record<string, string>;
  running: boolean;
  screen: string;
}"""
new = """export interface SecretGrantReference {
  grantRef: string;
  auditHead: { seq: number; hash: string };
}

export interface ProcessTaskContext {
  taskId: string;
  ref: ComputerRef;
  workspaceDir: string;
  dataDir: string;
  processGroupName: string;
  limits: ProcessTaskLimits;
  env: Record<string, string>;
  running: boolean;
  screen: string;
  /**
   * S3: the task config's declared secret NAMES (names only, never values).
   * These names are grant-gated: request.env can never carry them.
   */
  declaredSecretNames: ReadonlySet<string>;
  /**
   * S3 (T16): granted secret VALUES, written ONLY by applySecretGrant — the
   * audited grant channel — and composed into the child env OUTSIDE the
   * scrub's declared-vars argument at spawn. No other write path exists.
   */
  grantedSecretEnv: Record<string, string>;
  /** The grant + audit reference the current grant was applied under. */
  secretGrantRef: SecretGrantReference | null;
}"""
assert old in src, "anchor 2"
src = src.replace(old, new, 1)

# --- 3. createTaskContext ----------------------------------------------------
old = """    const context: ProcessTaskContext = {
      taskId,
      ref: {
        id: `process-${taskId}`,
        botId: taskId,
        kind: "process",
        providerRef: workspaceDir,
        fresh: true,
      },
      workspaceDir: await realpath(workspaceDir),
      dataDir: await realpath(dataDir),
      processGroupName: processGroupNameFor(taskId),
      limits: { ...DEFAULT_PROCESS_TASK_LIMITS, ...setup.limits },
      env: { ...setup.env },
      // The runtime starts with the session (D-Q9 lifecycle): creation is start.
      running: true,
      screen: "ready",
    };"""
new = """    // S3 (T15): declared secret names are validated at declaration — the
    // BotSecretName grammar excludes wildcards, so v1 has no wildcards.
    const declaredSecretNames = new Set(setup.requiredSecrets ?? []);
    for (const name of declaredSecretNames) {
      if (name.includes("*") || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
        throw new Error(
          `Invalid declared secret name ${JSON.stringify(name)}: wildcards are not supported in v1; names are lowercase letters, digits and underscores.`,
        );
      }
    }
    const context: ProcessTaskContext = {
      taskId,
      ref: {
        id: `process-${taskId}`,
        botId: taskId,
        kind: "process",
        providerRef: workspaceDir,
        fresh: true,
      },
      workspaceDir: await realpath(workspaceDir),
      dataDir: await realpath(dataDir),
      processGroupName: processGroupNameFor(taskId),
      limits: { ...DEFAULT_PROCESS_TASK_LIMITS, ...setup.limits },
      env: { ...setup.env },
      // The runtime starts with the session (D-Q9 lifecycle): creation is start.
      running: true,
      screen: "ready",
      declaredSecretNames,
      grantedSecretEnv: {},
      secretGrantRef: null,
    };"""
assert old in src, "anchor 3"
src = src.replace(old, new, 1)

# --- 4. execute(): screening + env composition -------------------------------
old = """    // Driver-injected per-task identity (process-group naming, V3 class).
    // These are runtime metadata ordered UNDER the task's declared vars —
    // never parent env leakage: the scrub still drops every undeclared
    // parent variable.
    const childEnv = {
      CODE_MODE_TASK_ID: task.taskId,
      CODE_MODE_TASK_GROUP: task.processGroupName,
      ...scrubProcessEnv(process.env, { ...task.env, ...request.env }),
    };"""
new = """    // S3 (LOW-7 binding constraint): the per-command env is screened BEFORE
    // anything else. A grant-gated name or value in request.env refuses the
    // whole command — fail closed, nothing spawns, no downgrade path.
    const screen = screenCommandEnv(request.env, task);
    if (!screen.ok) {
      yield { type: "stderr", data: screen.reason };
      yield { type: "exit", code: 1 };
      return;
    }
    // Driver-injected per-task identity (process-group naming, V3 class).
    // These are runtime metadata ordered UNDER the task's declared vars —
    // never parent env leakage: the scrub still drops every undeclared
    // parent variable. The SCRUB covers parent env + declared vars
    // (task config + the screened request.env); Q10-granted secrets enter
    // through a SEPARATE channel (grantedSecretEnv, applied after the
    // scrub) that only applySecretGrant can write — so a per-command env
    // can never re-inject what the grant path injects (T16).
    const childEnv = {
      CODE_MODE_TASK_ID: task.taskId,
      CODE_MODE_TASK_GROUP: task.processGroupName,
      ...scrubProcessEnv(process.env, { ...task.env, ...screen.env }),
      ...task.grantedSecretEnv,
    };"""
assert old in src, "anchor 4"
src = src.replace(old, new, 1)

# --- 5. applySecretGrant / clearSecretGrant (before suspend) ------------------
old = """  /**
   * Idle-suspend: stop the task's processes; trees are retained (D-Q9/R9)."""
new = """  /**
   * S3 (T16): the ONLY write path for granted secret values into a task
   * context. Refuses names outside the task's declared secret names and
   * requires the grant + audit reference, so a value cannot reach the spawn
   * env without having gone through grant + audit. Idempotent per grant:
   * a new grant REPLACES the previous grant's env (no silent accumulation).
   */
  async applySecretGrant(
    taskId: string,
    grantedEnv: Record<string, string>,
    ref: SecretGrantReference,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task ${JSON.stringify(taskId)}: no task context to grant into`);
    if (!ref || typeof ref.grantRef !== "string" || ref.grantRef.length === 0) {
      throw new Error(
        "applySecretGrant requires the grant reference: secrets cannot enter the spawn env without grant + audit",
      );
    }
    if (!ref.auditHead || !Number.isInteger(ref.auditHead.seq) || ref.auditHead.seq < 1) {
      throw new Error(
        "applySecretGrant requires the audit chain head: secrets cannot enter the spawn env without grant + audit",
      );
    }
    for (const name of Object.keys(grantedEnv)) {
      if (!task.declaredSecretNames.has(name)) {
        throw new Error(
          `Secret ${JSON.stringify(name)} is not declared by task ${JSON.stringify(taskId)}; refusing to grant undeclared names (deny-by-default).`,
        );
      }
    }
    task.grantedSecretEnv = { ...grantedEnv };
    task.secretGrantRef = { grantRef: ref.grantRef, auditHead: { ...ref.auditHead } };
  }

  /**
   * S3 (T19 companion): clears the injected values for subsequent spawns
   * (revoke/rotate paths call this; the force-stop of a LIVE task is the
   * caller's suspend()).
   */
  async clearSecretGrant(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.grantedSecretEnv = {};
    task.secretGrantRef = null;
  }

  /**
   * Idle-suspend: stop the task's processes; trees are retained (D-Q9/R9)."""
assert old in src, "anchor 5"
src = src.replace(old, new, 1)

# --- 6. module header comment update -----------------------------------------
old = """ * env scrub at spawn (process-env-scrub.ts) — only the allowlist plus the task
 * config's declared vars pass."""
new = """ * env scrub at spawn (process-env-scrub.ts) — only the allowlist plus the
 * task config's declared vars pass; S3 (T16) adds Q10-granted secrets through
 * a separate audited grant channel (applySecretGrant) that is composed AFTER
 * the scrub and can never be reached by per-command request.env (LOW-7)."""
assert old in src, "anchor 6"
src = src.replace(old, new, 1)

path.write_text(src)
print("process-sandbox patched")
