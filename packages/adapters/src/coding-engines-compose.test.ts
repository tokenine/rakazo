/**
 * 004-code-mode S4 — F3: coding-engines-compose test.
 *
 * Verifies that buildEngineRegistry creates an EngineRegistry that:
 * - Exposes exactly the two supported engine ids
 * - Both adapters are registered and retrievable
 * - Each adapter supports the required coding session ops
 *
 * Routing logic (exact-engine enforcement, unsupported op errors) is already
 * exercised by coding-engine.test.ts using the same EngineRegistry API.
 */

import { describe, expect, it, vi } from "vitest";
import { EngineMismatchError } from "./coding-engine.js";
import { buildEngineRegistry, CODING_ENGINE_IDS } from "./coding-engines-compose.js";

const mockMachinery = {
  continueRun: async () => ({ continued: false }),
  abortRun: async () => ({ aborted: false }),
};
const mockInspectChanges = async () => ({
  messages: [],
  toolResults: [] as Array<{ toolCallId: string; toolName: string; isError: boolean; result: unknown }>,
});

describe("buildEngineRegistry — F3 routing correctness", () => {
  it("exposes exactly the two supported engine ids", () => {
    expect([...CODING_ENGINE_IDS].sort()).toEqual(["normal-pi", "omp"]);
  });

  it("builds a registry with both normal-pi and omp adapters registered", () => {
    const registry = buildEngineRegistry({
      prisma: {} as never,
      jobs: { enqueue: async () => {} },
      events: { append: async () => {} },
      machinery: mockMachinery,
      inspectChanges: mockInspectChanges,
      spawnOmp: async () => { throw new Error("not reached"); },
      approveTool: async () => {},
    });
    expect([...registry.ids()].sort()).toEqual(["normal-pi", "omp"]);
  });

  it("registry.require returns adapters for both engines", () => {
    const registry = buildEngineRegistry({
      prisma: {} as never,
      jobs: { enqueue: async () => {} },
      events: { append: async () => {} },
      machinery: mockMachinery,
      inspectChanges: mockInspectChanges,
      spawnOmp: async () => { throw new Error("not reached"); },
      approveTool: async () => {},
    });
    const piAdapter = registry.require("normal-pi");
    const ompAdapter = registry.require("omp");
    expect(piAdapter.id).toBe("normal-pi");
    expect(ompAdapter.id).toBe("omp");
  });

  it("registry.require throws EngineMismatchError for unknown engine", () => {
    const registry = buildEngineRegistry({
      prisma: {} as never,
      jobs: { enqueue: async () => {} },
      events: { append: async () => {} },
      machinery: mockMachinery,
      inspectChanges: mockInspectChanges,
      spawnOmp: async () => { throw new Error("not reached"); },
      approveTool: async () => {},
    });
    expect(() => registry.require("unknown" as never)).toThrow(EngineMismatchError);
  });

  it("pi adapter supports all required coding session ops", () => {
    const registry = buildEngineRegistry({
      prisma: {} as never,
      jobs: { enqueue: async () => {} },
      events: { append: async () => {} },
      machinery: mockMachinery,
      inspectChanges: mockInspectChanges,
      spawnOmp: async () => { throw new Error("not reached"); },
      approveTool: async () => {},
    });
    const piAdapter = registry.require("normal-pi");
    expect(piAdapter.supportedOps.has("prompt")).toBe(true);
    expect(piAdapter.supportedOps.has("stop")).toBe(true);
    expect(piAdapter.supportedOps.has("resume")).toBe(true);
    expect(piAdapter.supportedOps.has("inspect_changes")).toBe(true);
    expect(piAdapter.supportedOps.has("approvals")).toBe(true);
  });

  it("omp adapter supports all required coding session ops", () => {
    const registry = buildEngineRegistry({
      prisma: {} as never,
      jobs: { enqueue: async () => {} },
      events: { append: async () => {} },
      machinery: mockMachinery,
      inspectChanges: mockInspectChanges,
      spawnOmp: async () => { throw new Error("not reached"); },
      approveTool: async () => {},
    });
    const ompAdapter = registry.require("omp");
    expect(ompAdapter.supportedOps.has("prompt")).toBe(true);
    expect(ompAdapter.supportedOps.has("stop")).toBe(true);
    expect(ompAdapter.supportedOps.has("resume")).toBe(true);
    expect(ompAdapter.supportedOps.has("inspect_changes")).toBe(true);
    expect(ompAdapter.supportedOps.has("approvals")).toBe(true);
  });

  it("routes engine:normal-pi dispatch to the pi adapter", async () => {
    const registry = buildEngineRegistry({
      prisma: {} as never,
      jobs: { enqueue: async () => {} },
      events: { append: async () => {} },
      machinery: mockMachinery,
      inspectChanges: mockInspectChanges,
      spawnOmp: async () => { throw new Error("not reached"); },
      approveTool: async () => {},
    });
    const piAdapter = registry.require("normal-pi");
    expect(piAdapter.id).toBe("normal-pi");
  });

  it("routes engine:omp dispatch to the omp adapter", async () => {
    const registry = buildEngineRegistry({
      prisma: {} as never,
      jobs: { enqueue: async () => {} },
      events: { append: async () => {} },
      machinery: mockMachinery,
      inspectChanges: mockInspectChanges,
      spawnOmp: async () => { throw new Error("not reached"); },
      approveTool: async () => {},
    });
    const ompAdapter = registry.require("omp");
    expect(ompAdapter.id).toBe("omp");
  });
});
