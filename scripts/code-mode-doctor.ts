/**
 * Runnable `code-mode doctor` entry (004-code-mode T8/V12).
 *
 * Usage: COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec tsx scripts/code-mode-doctor.ts
 *
 * Runs the preflight directly on this box (no host action, no docker) and
 * prints the report — including the unconditional secrets-state ON/OFF line
 * with its reason (D-Q10 item 6) — exiting non-zero on a fail verdict.
 */

import {
  formatCodeModeDoctorReport,
  runCodeModeDoctor,
} from "../packages/adapters/src/coding-doctor.js";

const report = await runCodeModeDoctor();
process.stdout.write(`${formatCodeModeDoctorReport(report)}\n`);
if (report.verdict !== "pass") process.exitCode = 1;
