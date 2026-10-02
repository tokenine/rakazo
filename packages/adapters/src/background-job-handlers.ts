import type {
  AgentHomeStore,
  AgentRuntime,
  BackgroundJobHandlers,
  JobPublisher,
  MessagingSurface,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import { messagingDeliverJob } from "@rakazo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { LocalArtifactStore } from "./artifacts.js";
import type { CloudAgentConnection } from "./cloud-agent-factory.js";
import { pollCloudAgent } from "./cloud-agent-poll.js";
import type { AcceptanceGateService } from "./coding-acceptance-gate.js";
import { createAcceptanceGateService } from "./coding-acceptance-gate.js";
import type { EngineRegistry } from "./coding-engine.js";
import { CODING_SESSION_TRIGGER } from "./coding-pi-adapter.js";
import type { ForgeClient } from "./coding-repo-to-pr.js";
import { createProcessCommandRunner, createWorkspaceDiffProvider } from "./coding-repo-to-pr.js";
import { createSessionServiceDeps, reconcileCrash } from "./coding-session-service.js";
import { expireComputerControl } from "./computer-control.js";
import { scheduleComputerSleep, sleepComputerIfIdle } from "./computer-idle.js";
import { performComputerUpdate } from "./computer-update.js";
import { compactHistory } from "./history-compaction.js";
import type { MemoryProviderResolver } from "./memory-provider-factory.js";
import { deliverMessagingOutbound, mirrorMessagingOutbound } from "./messaging-delivery.js";
import type { EncryptedSecretStore } from "./secrets.js";
import { expireTaughtSkillTeaching } from "./teaching-session.js";

/** The subset of the executor that background-job-handlers consumes. */
interface BackgroundJobExecutor {
  continueRun(runId: string, workerId: string): Promise<void>;
  wakeRoutine(routineId: string, scheduledFor: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Production service functions for T35/T36 — callable from the API layer
// ---------------------------------------------------------------------------

/**
 * T35 production: record an acceptance artifact for a coding session.
 * Called by the API layer when the user agrees to the outcome and verification
 * commands. The gate stays fail-closed until this is called.
 */
export async function recordCodingSessionAcceptance(
  deps: {
    prisma: PrismaClient;
  },
  input: {
    sessionId: string;
    outcome: string;
    verificationCommands: string[];
  },
): Promise<void> {
  const gate = createAcceptanceGateService({ prisma: deps.prisma });
  await gate.record(input);
}

export function createBackgroundJobHandlers(deps: {
  executor: BackgroundJobExecutor;
  prisma: PrismaClient;
  sandbox: SandboxProvider;
  home: AgentHomeStore;
  jobs: JobPublisher;
  events: ThreadEvents;
  workerId: string;
  runtime: AgentRuntime;
  secretStore: EncryptedSecretStore;
  memoryProviders: MemoryProviderResolver;
  deploymentModelKey?: string;
  dataDir?: string;
  messaging?: MessagingSurface;
  cloudAgent?: CloudAgentConnection | null;
  /** 004 T34: engine registry for coding session creation and dispatch. */
  registry?: EngineRegistry;
  /**
   * 004 T35: acceptance gate service for recording acceptance artifacts.
   * Wired from createAcceptanceGateService({ prisma }) in the composition root.
   */
  codingGate?: AcceptanceGateService;
  /**
   * 004 T37: granted-secret egress values for coding sessions.
   * { egressValuesForRun(runId): string[] }
   * Wired from composeCodingSecrets(cache) in the composition root.
   */
  codingSecrets?: { egressValuesForRun(runId: string): string[] };
  /**
   * 004 T36: data dir for artifact store (artifacts used by runRepoToPr).
   */
  dataDir?: string;
  /**
   * 004 T36: ForgeClient for opening GitHub PRs.
   * Boundary declaration: GitHub credentials live in the surfaces/CLI layer
   * (GitHub OAuth). Worker composition does not have a ForgeClient — the
   * run.completed handler guards on its presence and skips if absent.
   */
  forge?: ForgeClient;
}): BackgroundJobHandlers {
  const deliverMessaging = async (runId?: string) => {
    if (!deps.messaging) return;
    await deliverMessagingOutbound(
      {
        prisma: deps.prisma,
        messaging: deps.messaging,
        events: deps.events,
        jobs: deps.jobs,
        dataDir: deps.dataDir,
        secrets: deps.secretStore,
      },
      { runId },
      {
        operationId: `messaging.deliver:${runId ?? "drain"}`,
        traceId: `messaging.deliver:${runId ?? "drain"}`,
        spaceId: "",
        userId: "",
        signal: new AbortController().signal,
      },
    );
  };

  return {
    "run.continue": async (payload) => {
      // T38: reconcile crash state before retry for coding sessions.
      // Errors here are non-fatal — reconciliation is best-effort.
      try {
        const run = await deps.prisma.run.findUnique({
          where: { id: payload.runId },
          select: { trigger: true, status: true },
        });
        if (run?.trigger === CODING_SESSION_TRIGGER && run.status === "crashed") {
          const session = await deps.prisma.codingSession.findFirst({
            where: { latestRunId: payload.runId },
            select: { id: true, botId: true },
          });
          if (session?.botId) {
            const bot = await deps.prisma.bot.findUnique({
              where: { id: session.botId },
              select: { computer: { select: { homeRevision: true } } },
            });
            const homeRevision = bot?.computer?.homeRevision ?? undefined;
            const codingDeps = createSessionServiceDeps({
              prisma: deps.prisma,
              registry: deps.registry,
              homeStore: deps.home,
            });
            await reconcileCrash(codingDeps, session.id, homeRevision);
          }
        }
      } catch (err) {
        getLogger().error("T38 reconcileCrash failed", err);
      }
      await deps.executor.continueRun(payload.runId, deps.workerId);
      // Automatic messaging mirror: once the run's bot messages are durable,
      // copy them into the outbox. Never let mirror failures fail the run.
      if (deps.messaging) {
        await mirrorMessagingOutbound(
          {
            prisma: deps.prisma,
            messaging: deps.messaging,
            events: deps.events,
            jobs: deps.jobs,
            dataDir: deps.dataDir,
            secrets: deps.secretStore,
          },
          payload.runId,
        );
        await deps.jobs.enqueue(messagingDeliverJob()).catch(async (error) => {
          getLogger().error("messaging.deliver enqueue error", error);
          await deliverMessaging();
        });
      }
    },
    "messaging.deliver": async (payload) => {
      await deliverMessaging(payload.runId);
    },
    "routine.wakeup": async (payload) => {
      await deps.executor.wakeRoutine(payload.routineId, payload.scheduledFor);
    },
    "computer.update": async ({ updateId }) => {
      await performComputerUpdate(deps, updateId);
    },
    "computer.sleep": async (payload) => {
      await sleepComputerIfIdle(deps, payload.computerId);
    },
    "computer.control-expire": async (payload) => {
      if (await expireComputerControl(deps, payload.computerId, payload.leaseId)) {
        scheduleComputerSleep(deps.jobs, payload.computerId);
      }
    },
    "skill.teaching-expire": async (payload) => {
      await expireTaughtSkillTeaching(deps, payload.skillId);
    },
    // T36: fires when a coding run reaches terminal completed state.
    // Triggers repo-to-PR if workspace credential + acceptance artifact present.
    // Surfaces layer enqueues this after recording the acceptance.
    "run.completed": async (payload) => {
      const run = await deps.prisma.run.findUnique({
        where: { id: payload.runId },
        select: { trigger: true, status: true, botId: true },
      });
      if (run?.trigger !== CODING_SESSION_TRIGGER) return;
      const session = await deps.prisma.codingSession.findFirst({
        where: { latestRunId: payload.runId },
        select: { id: true, acceptance: true, botId: true, workspaceId: true },
      });
      if (!session) return;
      // Only trigger PR flow when acceptance has been recorded
      if (!session.acceptance) return;
      // runRepoToPr requires ForgeClient (GitHub credentials) which is a
      // hard boundary: it lives in the surfaces/CLI layer that owns the
      // GitHub OAuth flow. Declare the boundary here per Change 2 protocol.
      if (!deps.forge) {
        getLogger().warn("T36 run.completed: no ForgeClient — GitHub credentials boundary", {
          sessionId: session.id,
          runId: payload.runId,
        });
        return;
      }
      // Resolve the workspace directory from the home store.
      if (!deps.home || !deps.dataDir) {
        getLogger().error(
          "T36 run.completed: missing home store or dataDir for workspace resolution",
          {
            sessionId: session.id,
            runId: payload.runId,
          },
        );
        return;
      }
      const bot = await deps.prisma.bot.findUnique({
        where: { id: session.botId },
        select: { computer: { select: { homeKey: true } } },
      });
      if (!bot?.computer?.homeKey) {
        getLogger().error("T36 run.completed: bot has no homeKey", {
          sessionId: session.id,
          runId: payload.runId,
        });
        return;
      }
      const workspaceDir = deps.home.resolveAgentHomePath(bot.computer.homeKey, deps.dataDir);
      const diff = createWorkspaceDiffProvider(workspaceDir);
      const commandRunner = createProcessCommandRunner();
      const artifacts = new LocalArtifactStore(deps.dataDir);
      try {
        const outcome = await runRepoToPr(
          {
            prisma: deps.prisma,
            secretStore: deps.secretStore,
            diff,
            artifacts,
            commandRunner,
            forge: deps.forge,
          },
          {
            sessionId: session.id,
            repoDir: workspaceDir,
            implement: async () => {
              // The run has already completed — implement is a no-op.
              // The diff is captured relative to the snapshot taken before completion.
            },
          },
        );
        getLogger().info("T36 runRepoToPr completed", {
          sessionId: session.id,
          runId: payload.runId,
          prUrl: outcome.pr.url,
          diffFiles: outcome.diff.files.length,
          verificationRecords: outcome.verification.length,
        });
      } catch (err) {
        // Never re-throw from a background job handler — it would crash the runner.
        // Log the failure and let the session row hold the last known state.
        getLogger().error("T36 runRepoToPr failed", err, {
          sessionId: session.id,
          runId: payload.runId,
        });
      }
    },
    "cloud_agent.poll": async (payload) => {
      await pollCloudAgent(
        {
          prisma: deps.prisma,
          jobs: deps.jobs,
          events: deps.events,
          cloudAgent: deps.cloudAgent,
        },
        payload,
      );
    },
    "history.compact": async (payload) => {
      await compactHistory(
        {
          prisma: deps.prisma,
          runtime: deps.runtime,
          jobs: deps.jobs,
          memoryProviders: deps.memoryProviders,
          deploymentModelKey: deps.deploymentModelKey,
        },
        payload.threadId,
      );
    },
  };
}
