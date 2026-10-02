/**
 * 004-code-mode S4 — engine registry composition (F3).
 *
 * Composes the normal-pi and omp coding engine adapters into a single
 * EngineRegistry that dispatches to the correct adapter based on the
 * session's `engine` field.
 *
 * Both adapters implement CodingEngineAdapter; the registry is the
 * routing layer that enforces:
 * - Exact engine matching (V15: engine changes require labelled continuation)
 * - Unsupported ops surface as UnsupportedEngineOperationError
 *
 * This module is the composition root for S4: it assembles the adapters
 * with their real dependencies (prisma, jobs, events, etc.) into a
 * registry that the executor and session service use.
 */

import type { JobPublisher } from "@rakazo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import type { ChildProcess } from "node:child_process";

import { createEngineRegistry, type EngineRegistry } from "./coding-engine.js";
import { createCodingOmpAdapter, OmpRpcSession, type CodingOmpAdapter } from "./coding-omp-adapter.js";
import { createCodingPiAdapter, type CodingPiAdapter } from "./coding-pi-adapter.js";

// ---------------------------------------------------------------------------
// Shared engine registry — the complete set of supported coding engines
// ---------------------------------------------------------------------------

const CODING_ENGINE_IDS = ["normal-pi", "omp"] as const;
export { CODING_ENGINE_IDS };

/**
 * Build the engine registry that routes session ops to the correct adapter.
 *
 * @param deps.prisma - Database client
 * @param deps.jobs - Job publisher for enqueuing run Continue jobs
 * @param deps.events - Thread events surface for session lifecycle events
 * @param deps.machinery - ContinueRun and abortRun callbacks for the pi adapter
 * @param deps.inspectChanges - Diff surface for the pi adapter's inspect_changes op
 * @param deps.spawnOmp - Factory for the OMP RPC child process
 * @param deps.approveTool - Approval resolution for OMP builtin tool selects
 * @param deps.now - Clock for lease TTL calculations (defaults to Date.now)
 * @param deps.leaseTtlMs - Lease TTL in ms (defaults to 10 minutes)
 */
export function buildEngineRegistry(deps: {
  prisma: PrismaClient;
  jobs: Pick<JobPublisher, "enqueue">;
  events: {
    append: (event: Parameters<ThreadEvents["append"]>[0]) => Promise<unknown>;
  };
  machinery: {
    continueRun(sessionId: string): Promise<{ continued: boolean }>;
    abortRun(runId: string): Promise<{ aborted: boolean }>;
  };
  inspectChanges(sessionId: string): Promise<{
    messages: unknown[];
    toolResults: Array<{ toolCallId: string; toolName: string; isError: boolean; result: unknown }>;
  }>;
  spawnOmp(): Promise<ChildProcess>;
  approveTool(toolId: string, approval: "Approve" | "Deny"): Promise<void>;
  now?: () => Date;
  leaseTtlMs?: number;
}): EngineRegistry {
  // normal-pi adapter — implements CodingEngineAdapter
  const piAdapter: CodingPiAdapter = createCodingPiAdapter({
    prisma: deps.prisma,
    jobs: deps.jobs,
    events: deps.events,
    machinery: deps.machinery,
    inspectChanges: deps.inspectChanges,
    workerId: "coding-engine-registry",
    now: deps.now,
    leaseTtlMs: deps.leaseTtlMs,
  });
  // omp adapter — implements CodingEngineAdapter
  const ompAdapter: CodingOmpAdapter = createCodingOmpAdapter({
    sessionFactory: (innerDeps, sessionId) => new OmpRpcSession(innerDeps, sessionId),
    spawnOmp: deps.spawnOmp,
    approveTool: deps.approveTool,
  });

  // Both adapters implement CodingEngineAdapter — pass them directly to the registry
  return createEngineRegistry([piAdapter, ompAdapter]);
}
