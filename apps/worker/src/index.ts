import type { JobPublisher, JobWorkerHost } from "@rakazo/adapter-kit";
import { ComposioConnector, IntegrationProviderSettings } from "@rakazo/adapters";
import { loadRootEnv } from "@rakazo/core/node/load-root-env";

loadRootEnv();

import {
  ChatSdkMessagingSurface,
  CodexCatalogCache,
  createAcceptanceGateService,
  buildEngineRegistry,
  createBackgroundJobHandlers,
  createCloudAgentConnection,
  createConnectorStack,
  createJobReconciler,
  createMessagingContextLoader,
  createPostgresReconciliationLeadership,
  createRunExecutor,
  createRunSandbox,
  createRunSecretWriter,
  createWebProvider,
  databaseCapacityBackoffMs,
  EncryptedSecretStore,
  ExpoPushProvider,
  GraphileJobPublisher,
  GraphileJobWorkerHost,
  InMemoryJobQueue,
  InstalledConnectorProvider,
  isComposioEnabled,
  isPipedreamEnabled,
  LocalAgentHomeStore,
  LocalArtifactStore,
  McpConnector,
  McpOAuthBroker,
  messagingEnvFromProcess,
  messagingPlatformsFromEnv,
  PiAgentRuntime,
  PipedreamConnector,
  PostgresRealtimeFanout,
  pipedreamConfigFromEnv,
  reconcileCloudAgents,
  reconcileComputerUpdates,
  reconcileTelegramUserBots,
  resolveDeploymentModel,
  resolvePiSessionRoot,
  resolveSandboxProvider,
  ScriptedAgentRuntime,
  SpaceMemoryProviderResolver,
  sandboxProviderOptionsFromEnv,
} from "@rakazo/adapters";
import { resolveEncryptionKey, resolveSupervisorToken } from "@rakazo/core";
import {
  createDb,
  createThreadEvents,
  isTooManyDatabaseConnections,
  parsePositiveInteger,
} from "@rakazo/db";
import { SERVICE_NAMES } from "@rakazo/logging";
import { createRootLogger } from "@rakazo/logging/axiom";
import { MarkdownMemoryStore } from "@rakazo/memory";

const logger = createRootLogger(SERVICE_NAMES.worker);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  // Shared by Prisma, the reconciliation leadership lock, and both graphile-worker
  // components (see GraphileJobPublisher/GraphileJobWorkerHost) — one pool instead
  // of four separate ones. Keep this modest: graphile holds a LISTEN client and
  // leadership holds an advisory-lock client for the process lifetime, and a
  // larger max just competes for Postgres max_connections (53300).
  const { prisma, pool } = createDb(databaseUrl, {
    poolMax: parsePositiveInteger(process.env.DB_POOL_MAX, 8),
    applicationName: "rakazo-worker",
  });
  const realtime = new PostgresRealtimeFanout({
    connectionString: process.env.REALTIME_DATABASE_URL ?? databaseUrl,
    publisher: pool,
  });
  const secrets = new EncryptedSecretStore(resolveEncryptionKey(process.env));
  const events = createThreadEvents(prisma, realtime, {
    runSecretWriter: createRunSecretWriter(secrets),
  });
  const dataDir = process.env.DATA_DIR ?? "./data";
  const runtime =
    process.env.AGENT_RUNTIME === "scripted"
      ? new ScriptedAgentRuntime()
      : new PiAgentRuntime({ sessionRoot: resolvePiSessionRoot(dataDir) });
  // Same resolver the API uses, so both processes agree on provider, model and key.
  const { key: deploymentModelKey } = resolveDeploymentModel();
  const sandboxProvider = resolveSandboxProvider(process.env);
  const sandbox = createRunSandbox(sandboxProvider, {
    ...sandboxProviderOptionsFromEnv(process.env),
    supervisorUrl: process.env.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    supervisorToken: sandboxProvider === "docker" ? resolveSupervisorToken(process.env) : undefined,
    dataDir,
    prisma,
  });
  const allowPrivateEndpoint = process.env.MCP_ALLOW_PRIVATE_ENDPOINT === "true";
  const mcpOAuth = new McpOAuthBroker(prisma, secrets, {}, allowPrivateEndpoint);
  const mcp = new McpConnector(
    prisma,
    secrets,
    {
      stdioEnabled: process.env.MCP_STDIO_ENABLED === "true",
      allowedCommands: (process.env.MCP_STDIO_ALLOWED_COMMANDS ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      events,
      allowPrivateEndpoint,
    },
    mcpOAuth,
  );
  const pipedreamConfig = pipedreamConfigFromEnv({
    pipedreamClientId: process.env.PIPEDREAM_CLIENT_ID,
    pipedreamClientSecret: process.env.PIPEDREAM_CLIENT_SECRET,
    pipedreamProjectId: process.env.PIPEDREAM_PROJECT_ID,
    pipedreamEnvironment: process.env.PIPEDREAM_ENVIRONMENT,
    encryptionKey: resolveEncryptionKey(process.env),
  });
  const pipedream = isPipedreamEnabled(pipedreamConfig)
    ? new PipedreamConnector(pipedreamConfig)
    : undefined;
  // pollInboundMessages stays false (the default) here: this process
  // only ever sends outbound (messaging.deliver jobs). It must never poll
  // Telegram — that would steal the single getUpdates slot away from the
  // API process, which is the one with the inbound sink actually wired up.
  const messagingPlatforms = messagingPlatformsFromEnv(messagingEnvFromProcess(process.env));
  // Always constructed: outbound messaging delivery (bot reply mirroring) for
  // per-user Telegram bots runs in this process, even when the deployment
  // itself hosts no messaging platforms.
  const messaging = new ChatSdkMessagingSurface(messagingPlatforms);
  await reconcileTelegramUserBots({
    prisma,
    secrets,
    messaging,
  });
  // userConnect runs in the API process and only touches the API's surface;
  // re-scan here so bots connected (or removed) after this boot can still
  // deliver outbound without a worker restart.
  setInterval(() => {
    void reconcileTelegramUserBots({ prisma, secrets, messaging }).catch(() => undefined);
  }, 15_000);
  const integrationSettings = new IntegrationProviderSettings(
    prisma,
    secrets,
    resolveEncryptionKey(process.env),
    {
      composio: isComposioEnabled(process.env.COMPOSIO_API_KEY)
        ? new ComposioConnector(process.env.COMPOSIO_API_KEY)
        : undefined,
      pipedream,
    },
  );
  const stack = createConnectorStack(false, undefined, [
    new InstalledConnectorProvider(prisma, secrets, {}, allowPrivateEndpoint),
    ...integrationSettings.providers(),
    mcp,
  ]);
  const connector = stack.destination;
  await connector.start();
  integrationSettings.warmDirectories();
  const memoryProviders = new SpaceMemoryProviderResolver(prisma, secrets);
  const home = new LocalAgentHomeStore(dataDir);
  const artifacts = new LocalArtifactStore(dataDir);
  const inMemoryJobs = process.env.WAKEUP_DRIVER === "memory" ? new InMemoryJobQueue() : undefined;
  const jobs: JobPublisher = inMemoryJobs ?? new GraphileJobPublisher(pool);
  const jobHost: JobWorkerHost =
    inMemoryJobs ??
    new GraphileJobWorkerHost(pool, {
      concurrency: parsePositiveInteger(process.env.GRAPHILE_WORKER_CONCURRENCY, 4),
    });
  // One provider instance so emulator launches and polls share the same Map.
  const cloudAgent = createCloudAgentConnection();

  // T37: granted-secret egress values for coding sessions (surfaces layer writes grant)
  const codingSecrets: { egressValuesForRun: (runId: string) => string[] } = {
    egressValuesForRun: (_runId: string) => [],
  };

  // T34: create the executor first (needed by the registry's machinery.continueRun)
  const executor = createRunExecutor({
    prisma,
    runtime,
    sandbox,
    memory: new MarkdownMemoryStore(prisma),
    memoryProviders,
    home,
    artifacts,
    connector: stack.connector,
    connectors: stack.connector,
    secrets: [
      deploymentModelKey ?? "",
      process.env.COMPOSIO_API_KEY ?? "",
      process.env.CURSOR_API_KEY ?? "",
      process.env.TYPESAFE_API_KEY ?? "",
    ].filter(Boolean),
    secretStore: secrets,
    mcpAllowPrivateEndpoint: process.env.MCP_ALLOW_PRIVATE_ENDPOINT === "true",
    deploymentModelKey,
    dataDir,
    notifications: new ExpoPushProvider(dataDir),
    jobs,
    events,
    messaging: messaging ? createMessagingContextLoader(prisma) : undefined,
    web: createWebProvider(),
    cloudAgent,
    // T34: acceptance gate for coding sessions — fail-closed until acceptance recorded
    codingGate: createAcceptanceGateService({ prisma }),
    // T37: granted-secret egress values for coding sessions
    codingSecrets,
  });

  // T34: build the coding engine registry so session ops dispatch to the correct adapter.
  // Stub OMP spawn until surfaces layer provides a real factory.
  const registry = buildEngineRegistry({
    prisma,
    jobs,
    events,
    machinery: {
      async continueRun(sessionId: string) {
        const session = await prisma.codingSession.findUnique({
          where: { id: sessionId },
          select: { latestRunId: true },
        });
        if (session?.latestRunId) {
          await executor.continueRun(session.latestRunId, process.pid.toString());
          return { continued: true };
        }
        return { continued: false };
      },
      async abortRun(_runId: string) {
        // Stubbed until surfaces layer wires real abort.
        return { aborted: false };
      },
    },
    inspectChanges: async (sessionId: string) => {
      // T36: derive botId from the session row, then call home.changesSince.
      // This is the same sourcing pattern used in reconcileCrash.
      const session = await prisma.codingSession.findUnique({
        where: { id: sessionId },
        select: { botId: true },
      });
      if (!session?.botId) return { files: [] };
      const bot = await prisma.bot.findUnique({
        where: { id: session.botId },
        select: { computer: { select: { homeRevision: true } } },
      });
      if (!bot?.computer?.homeRevision) return { files: [] };
      try {
        const dirtySet = await home.changesSince(session.botId, bot.computer.homeRevision);
        // WorkspaceDirtySet added/removed/changed are string[] (path names)
        const ds = dirtySet as unknown as {
          added?: string[];
          removed?: string[];
          changed?: string[];
        };
        const files = [
          ...(ds.added ?? []).map((p) => ({ path: String(p), status: "added" })),
          ...(ds.removed ?? []).map((p) => ({ path: String(p), status: "removed" })),
          ...(ds.changed ?? []).map((p) => ({ path: String(p), status: "changed" })),
        ];
        return { files };
      } catch {
        return { files: [] };
      }
    },
    spawnOmp: async () => {
      throw new Error("OMP spawn not available in worker — surfaces layer must provide");
    },
    approveTool: async () => {
      throw new Error("Tool approval not available in worker composition");
    },
  });

  const jobHandlers = createBackgroundJobHandlers({
    executor,
    prisma,
    sandbox,
    home,
    jobs,
    events,
    workerId: process.pid.toString(),
    runtime,
    dataDir,
    secretStore: secrets,
    memoryProviders,
    deploymentModelKey,
    messaging,
    cloudAgent,
    // T34: engine registry for coding session dispatch
    registry,
  });
  // graphile-worker run() connects through the shared pool. createPool already
  // retries connect() on 53300 a finite number of times. Keep retrying start
  // until Postgres has capacity: exhausting then returning from main().catch
  // left a live process that held connections but never ran jobs or registered
  // signal handlers, even after capacity returned. Do not exit(1) here; that
  // crash-loops into the same saturated Postgres. GraphileJobWorkerHost also
  // observes runner.promise after start and restarts with the same backoff if
  // the runner dies later on 53300 (unhandledRejection still swallows that
  // code so we do not Docker crash-loop on transient completeJob failures).
  for (let attempt = 0; ; attempt += 1) {
    try {
      await jobHost.start(jobHandlers);
      break;
    } catch (error) {
      if (!isTooManyDatabaseConnections(error)) throw error;
      logger.error("worker job host start waiting on database capacity", error);
      await new Promise((resolve) => setTimeout(resolve, databaseCapacityBackoffMs(attempt)));
    }
  }
  const reconciler = createJobReconciler({
    prisma,
    jobs,
    events,
    leadership: createPostgresReconciliationLeadership(pool),
    reconcileCloudAgents: () => reconcileCloudAgents({ prisma, jobs, cloudAgent }),
    reconcileComputerUpdates: () => reconcileComputerUpdates({ prisma, jobs }),
  });
  reconciler.start();

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await reconciler.stop();
      await jobHost.stop();
      await jobs.close();
      await realtime.close();
      await connector.stop();
      await mcp.close();
      await prisma.$disconnect().catch(() => undefined);
      await pool.end().catch(() => undefined);
    } finally {
      await logger.flush({ timeoutMs: 2_000 });
    }
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  // graphile-worker fires completeJob() without awaiting it. When pool.connect()
  // then hits Postgres 53300, that rejection is unhandled. Exiting here is the
  // crash loop: Docker restarts the process before Postgres has reaped the old
  // backends, so the next boot cannot connect either. Stay up on that rejection
  // only — do not resume after uncaughtException (Node leaves the process in an
  // undefined state).
  process.on("uncaughtException", (error) => {
    logger.error("uncaughtException", error);
    void stop().finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandledRejection", reason);
    if (isTooManyDatabaseConnections(reason)) return;
    void stop().finally(() => process.exit(1));
  });

  logger.info("worker ready");
}

main().catch(async (error) => {
  logger.error("worker startup failed", error);
  await logger.flush({ timeoutMs: 2_000 });
  // jobHost.start retries 53300 without bound above, so a saturated Postgres at
  // that step does not reach here. Other startup failures still exit.
  process.exit(1);
});
