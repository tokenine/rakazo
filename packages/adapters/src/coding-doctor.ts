/**
 * 004-code-mode T8 — `code-mode doctor` preflight (Q9-final process driver).
 *
 * Verifies, on the live box and with no host action and no docker dependency:
 *   (a) spawn limits are enforceable (ulimit/nice under a real spawn),
 *   (b) per-task tree creation + isolation,
 *   (c) the env scrub is active (a poisoned parent canary must NOT leak).
 *
 * D-Q10 item 6 (Chief tightening, 2026-10-01): doctor prints the CURRENT
 * secrets state (ON or OFF) and WHY — driver kind + injection guarantee — in
 * EVERY run, in BOTH directions. An unannounced OFF is as much a provenance
 * problem as an unannounced ON; there is no silent degradation either way.
 *
 * Threat model (D-Q9): this driver guards accidents and resource conflicts on
 * trusted user code. It does NOT provide container-grade containment; the
 * doctor never claims otherwise.
 *
 * Ratified v1 constants (PROVENANCE-ADDENDUM §5) are restated here where the
 * code declares them: lease TTL default = 10 minutes; default credential
 * name = `github_token`.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_LEASE_TTL_MS } from "./coding-session-service.js";
import { scrubProcessEnv } from "./process-env-scrub.js";
import { DEFAULT_PROCESS_TASK_LIMITS } from "./process-sandbox.js";

/** The v1 isolation driver per D-Q9 FINAL r2 (option 3, process-level). */
export const CODE_MODE_DRIVER_KIND = "process";

/**
 * Spawn-limits probe values: what the doctor proves enforceable at spawn.
 * Mirrors the driver's DEFAULT_PROCESS_TASK_LIMITS (imported) so the doctor
 * always verifies exactly what the runtime applies.
 */
export const DOCTOR_SPAWN_LIMITS = DEFAULT_PROCESS_TASK_LIMITS;

const CANARY_ENV_KEY = "CODE_MODE_DOCTOR_CANARY";
const DECLARED_ENV_KEY = "CODE_MODE_DOCTOR_DECLARED";

/**
 * Ratified v1 constants (Chief decision, S1 PROVENANCE-ADDENDUM §5). Both are
 * restated where the code declares them; the lease TTL must keep matching the
 * session service's DEFAULT_LEASE_TTL_MS.
 */
export const RATIFIED_V1_CONSTANTS = {
  /** DEFAULT_LEASE_TTL_MS expressed in minutes (= 10 * 60_000 ms). */
  leaseTtlDefaultMinutes: DEFAULT_LEASE_TTL_MS / 60_000,
  defaultCredentialName: "github_token",
} as const;

export type CodeModeDoctorProbe = "spawn-limits" | "task-tree-isolation" | "env-scrub";

export interface CodeModeDoctorCheck {
  id: CodeModeDoctorProbe;
  label: string;
  passed: boolean;
  detail: string;
}

export interface CodeModeSecretsState {
  state: "ON" | "OFF";
  reason: string;
}

export interface CodeModeDoctorProbeResult {
  ok: boolean;
  detail: string;
}

export interface CodeModeDoctorOptions {
  /** Driver kind the runtime reports; defaults to the v1 process driver. */
  driverKind?: string;
  /** Failure-injection seam: replaces the real probes (offline determinism). */
  runProbe?: (probe: CodeModeDoctorProbe) => Promise<CodeModeDoctorProbeResult>;
  /** Root for the task-tree probe; defaults to a fresh temp dir. */
  root?: string;
}

export interface CodeModeDoctorReport {
  driver: string;
  verdict: "pass" | "fail";
  checks: CodeModeDoctorCheck[];
  secrets: CodeModeSecretsState;
  constants: typeof RATIFIED_V1_CONSTANTS;
  remediation: string[];
}

const DOCTOR_CHECK_LABELS: Record<CodeModeDoctorProbe, string> = {
  "spawn-limits": "Spawn limits enforceable (ulimit/nice)",
  "task-tree-isolation": "Per-task tree creation + isolation",
  "env-scrub": "Env scrub active at spawn",
};

/**
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
}

export async function runCodeModeDoctor(
  options: CodeModeDoctorOptions = {},
): Promise<CodeModeDoctorReport> {
  const driver = options.driverKind ?? CODE_MODE_DRIVER_KIND;
  const runProbe =
    options.runProbe ?? ((probe: CodeModeDoctorProbe) => runRealDoctorProbe(probe, options.root));
  const checks: CodeModeDoctorCheck[] = [];
  for (const id of ["spawn-limits", "task-tree-isolation", "env-scrub"] as const) {
    let result: CodeModeDoctorProbeResult;
    try {
      result = await runProbe(id);
    } catch (error) {
      result = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    checks.push({ id, label: DOCTOR_CHECK_LABELS[id], passed: result.ok, detail: result.detail });
  }
  const failed = checks.filter((check) => !check.passed);
  const remediation = failed.map((check) => DOCTOR_REMEDIATION[check.id]);
  return {
    driver,
    verdict: failed.length === 0 ? "pass" : "fail",
    checks,
    secrets: codeModeSecretsState(driver),
    constants: RATIFIED_V1_CONSTANTS,
    remediation,
  };
}

const DOCTOR_REMEDIATION: Record<CodeModeDoctorProbe, string> = {
  "spawn-limits":
    "Spawn limits could not be applied. Verify bash's ulimit builtin and nice are available to the runtime user, and that no hard rlimit ceiling blocks them; fix the box config before starting coding tasks.",
  "task-tree-isolation":
    "Per-task trees could not be created or isolated. Check that the runtime user can create directories under the task root and that no path collision or permission error remains.",
  "env-scrub":
    "The env scrub is not holding: a parent variable leaked into the task environment. Do not start coding tasks; repair the scrub allowlist path (process-env-scrub.ts) before any spawn.",
};

/** Formats the doctor report. The secrets-state line is unconditional. */
export function formatCodeModeDoctorReport(report: CodeModeDoctorReport): string {
  const lines: string[] = [];
  lines.push(`code-mode doctor — driver: ${report.driver} (trusted-code threat model, D-Q9)`);
  for (const check of report.checks) {
    lines.push(
      `  ${check.passed ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` — ${check.detail}` : ""}`,
    );
  }
  // Always printed, both directions (D-Q10 item 6): ON or OFF plus the reason.
  lines.push(`  secrets state: ${report.secrets.state} — reason: ${report.secrets.reason}`);
  lines.push(
    `  v1 constants: lease TTL default ${report.constants.leaseTtlDefaultMinutes} minutes; default credential name ${report.constants.defaultCredentialName}`,
  );
  lines.push(`verdict: ${report.verdict.toUpperCase()}`);
  for (const line of report.remediation) lines.push(`  remediation: ${line}`);
  return lines.join("\n");
}

/** The real probes. Each spawns a real process; no host action, no docker. */
async function runRealDoctorProbe(
  probe: CodeModeDoctorProbe,
  root?: string,
): Promise<CodeModeDoctorProbeResult> {
  if (probe === "spawn-limits") return probeSpawnLimits();
  if (probe === "task-tree-isolation") return probeTaskTreeIsolation(root);
  return probeEnvScrub();
}

async function probeSpawnLimits(): Promise<CodeModeDoctorProbeResult> {
  const limits = DOCTOR_SPAWN_LIMITS;
  const program = [
    `ulimit -t ${limits.cpuSeconds}`,
    `ulimit -v ${limits.addressSpaceKb}`,
    `ulimit -u ${limits.maxProcesses}`,
    `ulimit -f ${limits.fileSizeBlocks}`,
    `nice -n ${limits.nice} true`,
    "echo limits-ok",
  ].join(" && ");
  if (process.platform === "win32") {
    return { ok: false, detail: "spawn limits (ulimit/nice) require a POSIX runtime" };
  }
  const outcome = await spawnCapture(["bash", "-c", program]);
  const ok = outcome.code === 0 && outcome.stdout.includes("limits-ok");
  return {
    ok,
    detail: ok
      ? `ulimit -t/-v/-u/-f and nice -n ${limits.nice} applied in a spawned shell (exit ${outcome.code}); ` +
        // LOW-5 honest disclosure: RLIMIT_NPROC is PER-UID, not per task.
        "note: RLIMIT_NPROC (ulimit -u " +
        limits.maxProcesses +
        ") bounds the runtime " +
        "user's TOTAL process count on this box — shared across concurrent tasks and " +
        "everything else running as this UID — an accident/resource guard, not per-task containment"
      : `spawned shell could not apply limits: exit ${outcome.code} ${outcome.stderr.trim()}`,
  };
}

async function probeTaskTreeIsolation(root?: string): Promise<CodeModeDoctorProbeResult> {
  const base = root ?? (await mkdtemp(path.join(tmpdir(), "rakazo-doctor-")));
  const cleanup = root === undefined;
  try {
    const a = path.join(base, "cm-doctor-a-workspace");
    const b = path.join(base, "cm-doctor-b-workspace");
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(path.join(a, "task-a-only.txt"), "task a", "utf8");
    const bEntries = await readdir(b);
    if (bEntries.includes("task-a-only.txt")) {
      return { ok: false, detail: "task A's file is visible inside task B's tree" };
    }
    const resolvedA = path.resolve(a);
    const resolvedB = path.resolve(b);
    if (resolvedA === resolvedB) return { ok: false, detail: "task trees collapsed to one path" };
    const aInfo = await stat(a);
    const bInfo = await stat(b);
    if (!aInfo.isDirectory() || !bInfo.isDirectory()) {
      return { ok: false, detail: "task trees are not directories" };
    }
    return {
      ok: true,
      detail: `created and isolated ${path.basename(resolvedA)} and ${path.basename(resolvedB)} under ${path.basename(base)}`,
    };
  } finally {
    if (cleanup) await rm(base, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function probeEnvScrub(): Promise<CodeModeDoctorProbeResult> {
  // Poison the doctor's own environment with a canary. If the scrub passed the
  // parent env through, the child would see it — the probe fails.
  const canary = `canary-${randomUUID()}`;
  const previous = process.env[CANARY_ENV_KEY];
  process.env[CANARY_ENV_KEY] = canary;
  try {
    const declaredValue = "declared-passed";
    const childEnv = scrubProcessEnv(process.env, {
      [DECLARED_ENV_KEY]: declaredValue,
    });
    const outcome = await spawnCapture(
      ["bash", "-c", `printf 'canary=%s declared=%s' "$${CANARY_ENV_KEY}" "$${DECLARED_ENV_KEY}"`],
      childEnv,
    );
    if (outcome.stdout.includes(canary)) {
      return { ok: false, detail: "parent canary leaked through the env scrub" };
    }
    if (!outcome.stdout.includes(`declared=${declaredValue}`)) {
      return { ok: false, detail: "declared task-config var did not reach the child" };
    }
    return { ok: true, detail: "canary absent, declared passed (allowlist-only child env)" };
  } finally {
    if (previous === undefined) delete process.env[CANARY_ENV_KEY];
    else process.env[CANARY_ENV_KEY] = previous;
  }
}

function spawnCapture(
  argv: string[],
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}
