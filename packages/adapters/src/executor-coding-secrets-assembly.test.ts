/**
 * 004-code-mode T37 — RED: composeCodingSecrets assembles real egress values.
 *
 * The executor's `codingSecrets: { egressValuesForRun(runId) }` must return the
 * actual granted secret values for a run. Since `egressValuesForRun` is sync
 * (type: `(runId: string) => string[]`) but `resolveGrantedSecrets` is async,
 * the design uses a shared in-memory cache: the surfaces layer pre-resolves
 * granted values and stores them in the cache; the executor reads them synchronously.
 *
 * This test verifies the cache-based sync accessor contract.
 */

import { describe, it, expect } from "vitest";
import { composeCodingSecrets } from "./coding-secret-grants.js";

describe("T37 RED: composeCodingSecrets assembles real egress values", () => {
  it("granted run → egressValuesForRun returns planted values", () => {
    const cache = new Map<string, string[]>();
    const codingSecrets = composeCodingSecrets(cache);

    // Surfaces layer pre-resolves and caches the granted values.
    cache.set("run-1", ["SECRET_VAL_1", "SECRET_VAL_2"]);

    expect(codingSecrets.egressValuesForRun("run-1")).toEqual(["SECRET_VAL_1", "SECRET_VAL_2"]);
  });

  it("ungranted run → egressValuesForRun returns empty array", () => {
    const cache = new Map<string, string[]>();
    const codingSecrets = composeCodingSecrets(cache);

    expect(codingSecrets.egressValuesForRun("run-unknown")).toEqual([]);
  });

  it("cross-run isolation: grants for run A don't leak to run B", () => {
    const cache = new Map<string, string[]>();
    const codingSecrets = composeCodingSecrets(cache);

    cache.set("run-A", ["RUN_A_SECRET"]);
    cache.set("run-B", ["RUN_B_SECRET"]);

    expect(codingSecrets.egressValuesForRun("run-A")).toEqual(["RUN_A_SECRET"]);
    expect(codingSecrets.egressValuesForRun("run-B")).toEqual(["RUN_B_SECRET"]);
    expect(codingSecrets.egressValuesForRun("run-C")).toEqual([]);
  });

  it("revoked grant → cache miss returns empty (surfaces layer is responsible for removing from cache)", () => {
    const cache = new Map<string, string[]>();
    const codingSecrets = composeCodingSecrets(cache);

    // Grant was issued but then revoked — surfaces layer removes from cache.
    cache.set("run-revoked", ["SHOULD_BE_REVOKED"]);
    // Simulate surfaces layer clearing the cache entry on revocation.
    cache.delete("run-revoked");

    expect(codingSecrets.egressValuesForRun("run-revoked")).toEqual([]);
  });

  it("empty cache → all runs return [] (legacy literal-only redaction)", () => {
    const cache = new Map<string, string[]>();
    const codingSecrets = composeCodingSecrets(cache);

    expect(codingSecrets.egressValuesForRun("any-run")).toEqual([]);
  });
});
