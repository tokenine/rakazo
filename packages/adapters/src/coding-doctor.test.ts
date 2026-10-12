import { afterEach, describe, expect, it } from "vitest";
import {
  CODE_MODE_DRIVER_KIND,
  codeModeSecretsState,
  formatCodeModeDoctorReport,
  RATIFIED_V1_CONSTANTS,
  runCodeModeDoctor,
} from "./coding-doctor.js";
import { scrubProcessEnv } from "./process-env-scrub.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs
      .splice(0)
      .map((dir) =>
        import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true })),
      ),
  );
});

describe("code-mode secrets-state disclosure (D-Q10 item 6, both directions)", () => {
  it("is ON under the v1 process driver with the driver + injection guarantee as the reason", () => {
    const state = codeModeSecretsState(CODE_MODE_DRIVER_KIND);
    expect(state.state).toBe("ON");
    expect(state.reason).toMatch(/process/);
    expect(state.reason).toMatch(/spawn|bootstrap/i);
  });

  it("is OFF with an explicit reason on any driver that cannot guarantee spawn-env injection", () => {
    for (const driver of ["future-container", "none", ""]) {
      const state = codeModeSecretsState(driver);
      expect(state.state).toBe("OFF");
      expect(state.reason).toMatch(/fail closed|cannot be guaranteed|spawn-env/i);
    }
  });

  it("never degrades silently: an unannounced state is impossible because the reason is mandatory", () => {
    expect(codeModeSecretsState("process").reason.trim().length).toBeGreaterThan(0);
    expect(codeModeSecretsState("other").reason.trim().length).toBeGreaterThan(0);
  });
});

describe("code-mode doctor preflight (V12)", () => {
  it("passes on the team box: spawn limits enforceable, task trees isolated, env scrub active", async () => {
    const report = await runCodeModeDoctor();
    expect(report.driver).toBe("process");
    expect(report.checks.map((check) => check.id)).toEqual([
      "spawn-limits",
      "task-tree-isolation",
      "env-scrub",
    ]);
    for (const check of report.checks) {
      expect(check.passed, `${check.id} failed: ${check.detail}`).toBe(true);
    }
    expect(report.verdict).toBe("pass");
    expect(report.remediation).toEqual([]);
    // LOW-5: the spawn-limits detail must disclose RLIMIT_NPROC's per-UID
    // semantics — an accident guard shared across the whole UID, not
    // per-task containment.
    const limits = report.checks.find((check) => check.id === "spawn-limits");
    expect(limits?.detail).toMatch(/RLIMIT_NPROC/);
    expect(limits?.detail).toMatch(/user's TOTAL process count/i);
    expect(limits?.detail).toMatch(/not per-task containment/i);
  });

  it("creates per-task trees that are isolated from each other (probe-level proof)", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-doctor-"));
    dirs.push(root);
    const report = await runCodeModeDoctor({ root });
    const isolation = report.checks.find((check) => check.id === "task-tree-isolation");
    expect(isolation?.passed).toBe(true);
    // The two probe trees exist on disk, are id-prefixed, and are distinct.
    const { access } = await import("node:fs/promises");
    const a = path.join(root, "cm-doctor-a-workspace");
    const b = path.join(root, "cm-doctor-b-workspace");
    await access(a);
    await access(b);
    expect(a).not.toBe(b);
  });

  it("prints the secrets state (ON or OFF) and its reason in EVERY run, including failures", async () => {
    const passing = formatCodeModeDoctorReport(await runCodeModeDoctor());
    expect(passing).toMatch(/secrets state: ON\b/);
    expect(passing).toMatch(/reason:/i);

    const failing = await runCodeModeDoctor({
      runProbe: async () => ({ ok: false, detail: "injected failure" }),
    });
    expect(failing.verdict).toBe("fail");
    const failingText = formatCodeModeDoctorReport(failing);
    expect(failingText).toMatch(/secrets state: (ON|OFF)\b/);
    expect(failingText).toMatch(/reason:/i);

    const off = formatCodeModeDoctorReport(
      await runCodeModeDoctor({ driverKind: "future-container" }),
    );
    expect(off).toMatch(/secrets state: OFF\b/);
    expect(off).toMatch(/reason:/i);
  });

  it("fail-fast verdict + remediation text on any failed check", async () => {
    const report = await runCodeModeDoctor({
      runProbe: async (probe) =>
        probe === "spawn-limits"
          ? { ok: false, detail: "ulimit could not be applied" }
          : { ok: true, detail: "ok" },
    });
    expect(report.verdict).toBe("fail");
    const failed = report.checks.filter((check) => !check.passed);
    expect(failed.map((check) => check.id)).toEqual(["spawn-limits"]);
    expect(report.remediation.length).toBeGreaterThan(0);
    expect(report.remediation.join("\n")).toMatch(/spawn limits|ulimit|resource/i);
    // The passing checks stay recorded: fail-fast on the verdict, not on visibility.
    expect(report.checks.find((check) => check.id === "env-scrub")?.passed).toBe(true);
  });

  it("env scrub probe proves a parent canary does NOT leak and a declared var DOES pass", async () => {
    const report = await runCodeModeDoctor();
    const scrub = report.checks.find((check) => check.id === "env-scrub");
    expect(scrub?.passed).toBe(true);
    expect(scrub?.detail).toMatch(/canary absent/i);
    expect(scrub?.detail).toMatch(/declared passed/i);
  });

  it("restates the ratified v1 constants (lease TTL default 10 minutes, default credential name github_token)", async () => {
    expect(RATIFIED_V1_CONSTANTS.leaseTtlDefaultMinutes).toBe(10);
    expect(RATIFIED_V1_CONSTANTS.defaultCredentialName).toBe("github_token");
    const report = await runCodeModeDoctor();
    expect(report.constants).toEqual(RATIFIED_V1_CONSTANTS);
    const { DEFAULT_LEASE_TTL_MS } = await import("./coding-session-service.js");
    expect(DEFAULT_LEASE_TTL_MS).toBe(RATIFIED_V1_CONSTANTS.leaseTtlDefaultMinutes * 60_000);
  });
});

describe("process env scrub primitive (shared with the T9 task runtime)", () => {
  it("keeps only the allowlist plus declared vars; everything else is dropped", () => {
    const scrubbed = scrubProcessEnv(
      { PATH: "/usr/bin", HOME: "/home/u", POISON: "nope", ANOTHER_POISON: "nope2" },
      { TASK_TOKEN: "granted" },
    );
    expect(scrubbed).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      TASK_TOKEN: "granted",
    });
  });

  it("never lets a declared var name shadow-restrict the allowlist or vice versa", () => {
    const scrubbed = scrubProcessEnv(
      { PATH: "/usr/bin", TERM: "dumb" },
      { PATH: "/declared/over/mb" },
    );
    // Declared task-config vars are the explicit override channel; the allowlist
    // fills only what the task config did not declare.
    expect(scrubbed.PATH).toBe("/declared/over/mb");
    expect(scrubbed.TERM).toBe("dumb");
  });
});
