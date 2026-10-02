/**
 * T38 RED — production crash-reconciliation caller.
 *
 * Verifies that reconcileCrash is called before any retry on the coding run path.
 * reconcileCrash exists (tested in coding-session-service.test.ts); this tests that
 * the BACKGROUND JOB HANDLER calls it before retrying a crashed coding_session run.
 *
 * RED: no production caller exists — background-job-handlers.ts does NOT import
 * or call reconcileCrash in the run.continue handler. The source check fails.
 *
 * GREEN: background-job-handlers.ts imports reconcileCrash and createSessionServiceDeps,
 * and calls reconcileCrash(sessionId, homeRevision) before enqueueing retry
 * for a coding_session run.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("T38 RED: reconcileCrash is called before retry on the coding run path", () => {
  it("reconcileCrash function exists and is exported", async () => {
    const mod = await import("./coding-session-service.js");
    expect(typeof mod.reconcileCrash).toBe("function");
  });

  it("background-job-handlers SHOULD call reconcileCrash before retrying a crashed coding_session run", () => {
    /**
     * T38 GAP: background-job-handlers.ts does NOT currently call reconcileCrash
     * before enqueueing a retry for a crashed coding_session run.
     *
     * RED: reads the source file and asserts reconcileCrash is imported/called.
     * This fails until T38 is wired.
     *
     * GREEN: add to background-job-handlers.ts:
     *   import { reconcileCrash, createSessionServiceDeps } from "./coding-session-service.js";
     * And call reconcileCrash in run.continue handler before retry.
     */

    const handlerPath = resolve(__dirname, "background-job-handlers.ts");
    const source = readFileSync(handlerPath, "utf-8");

    // T38: reconcileCrash must be imported and called in run.continue handler
    // RED fails until this is wired
    expect(source).toContain("reconcileCrash");
  });
});
