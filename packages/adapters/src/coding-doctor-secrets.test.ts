import { describe, expect, it } from "vitest";
import {
  CODE_MODE_DRIVER_KIND,
  codeModeSecretsState,
  formatCodeModeDoctorReport,
  runCodeModeDoctor,
} from "./coding-doctor.js";
import { secretsRuntimeSupport } from "./coding-secret-grants.js";

/**
 * 004-code-mode S3 (T21, V11) — one predicate, both directions, never silent.
 *
 * The doctor's secrets-state line and the RUNTIME fail-closed guard must
 * share a single ON/OFF predicate (secretsRuntimeSupport) so the gate and
 * the doctor cannot drift, and the confidentiality-bounded-by-threat-model
 * disclosure must ride the doctor's line in BOTH directions (ON and OFF).
 * The S2 V12 contract stays intact: state + reason are unconditional.
 */

const DRIVER_KINDS = ["process", "desktop", "docker", "future-container", "e2b", ""];

describe("doctor ↔ runtime share one secrets predicate (T21)", () => {
  it("codeModeSecretsState agrees with secretsRuntimeSupport for every driver kind", () => {
    for (const driver of DRIVER_KINDS) {
      const support = secretsRuntimeSupport(driver);
      const state = codeModeSecretsState(driver);
      expect(state.state).toBe(support.enabled ? "ON" : "OFF");
      expect(state.reason).toBe(support.disclosure);
    }
  });

  it("is ON only for the v1 process driver", () => {
    expect(codeModeSecretsState(CODE_MODE_DRIVER_KIND).state).toBe("ON");
    for (const driver of DRIVER_KINDS.filter((kind) => kind !== "process")) {
      expect(codeModeSecretsState(driver).state).toBe("OFF");
    }
  });

  it("the bounded-confidentiality disclosure appears in the doctor output in BOTH directions", async () => {
    const on = formatCodeModeDoctorReport(await runCodeModeDoctor());
    expect(on).toMatch(/secrets state: ON\b/);
    expect(on).toMatch(/same-UID/);
    expect(on).toMatch(/threat model/);

    const off = formatCodeModeDoctorReport(
      await runCodeModeDoctor({ driverKind: "future-container" }),
    );
    expect(off).toMatch(/secrets state: OFF\b/);
    expect(off).toMatch(/same-UID/);
    expect(off).toMatch(/threat model/);
  });
});
