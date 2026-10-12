/**
 * 004-code-mode T5 — repo-to-PR flow (R1/A3, V2 pi path).
 *
 * implement → inspectable diff → verification record (command, exit status,
 * evidence artifact) → pull request via the existing workspace credential.
 * The credential comes from the existing bot-secret facility (bot_secrets,
 * encrypted at rest); PR creation is exercised against an offline forge
 * double — no network in v1 evidence.
 */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AdapterContext, ArtifactStore } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { parseAcceptanceRecord } from "./coding-acceptance-gate.js";
import type { EncryptedSecretStore } from "./secrets.js";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  exitStatus: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(argv: string[], cwd: string): Promise<CommandResult>;
}

/** Production runner: real processes for verification commands. */
export function createProcessCommandRunner(timeoutMs = 120_000): CommandRunner {
  return {
    async run(argv, cwd) {
      try {
        const { stdout, stderr } = await execFileAsync(argv[0]!, argv.slice(1), {
          cwd,
          timeout: timeoutMs,
          encoding: "utf8",
        });
        return { exitStatus: 0, stdout, stderr };
      } catch (error) {
        const failure = error as { code?: number | string; stdout?: string; stderr?: string };
        const exitStatus = typeof failure.code === "number" ? failure.code : 1;
        return {
          exitStatus,
          stdout: failure.stdout ?? "",
          stderr: failure.stderr ?? (error instanceof Error ? error.message : String(error)),
        };
      }
    },
  };
}

export interface ForgeCredential {
  name: string;
  token: string;
}

export interface PullRequestInput {
  repoDir: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  credential: ForgeCredential;
}

export interface PullRequestResult {
  url: string;
  number: number;
}

export interface ForgeClient {
  openPullRequest(input: PullRequestInput): Promise<PullRequestResult>;
}

export interface FakeForgeCall extends PullRequestInput {}

export interface FakeForge extends ForgeClient {
  readonly calls: FakeForgeCall[];
}

/** Offline forge double: records PR opens, never touches a network. */
export function createFakeForge(): FakeForge {
  const calls: FakeForgeCall[] = [];
  return {
    calls,
    async openPullRequest(input) {
      if (!input.credential?.token) {
        throw new Error("A workspace credential is required to open a pull request");
      }
      calls.push({ ...input });
      const number = calls.length;
      return { url: `https://forge.example.test/pull/${number}`, number };
    },
  };
}

export class MissingWorkspaceCredentialError extends Error {
  constructor(name: string) {
    super(
      `Workspace credential "${name}" is missing. It is a blocker, not permission to bypass access controls.`,
    );
    this.name = "MissingWorkspaceCredentialError";
  }
}

/**
 * Resolves the workspace credential through the existing bot-secret facility
 * (bot_secrets rows, AES-GCM at rest). A3: PR creation uses the permissions
 * already granted to that credential; nothing new is authorized here.
 */
export async function resolveWorkspaceCredential(
  prisma: PrismaClient,
  input: {
    scope: { userId: string; spaceId: string; botId: string };
    name: string;
    secretStore: EncryptedSecretStore;
  },
): Promise<ForgeCredential> {
  const row = await prisma.botSecret.findFirst({
    where: { ...input.scope, name: input.name },
  });
  if (!row) throw new MissingWorkspaceCredentialError(input.name);
  const record = row as unknown as { id: string; ciphertext: string };
  return {
    name: input.name,
    token: input.secretStore.load(record.ciphertext, record.id),
  };
}

export interface WorkspaceDiff {
  files: Array<{ path: string; status: "added" | "modified" | "deleted" }>;
  /** Inspectable unified-style text over the changed files. */
  unified: string;
}

export interface WorkspaceDiffProvider {
  before(): Promise<void>;
  after(): Promise<WorkspaceDiff>;
}

async function snapshot(repoDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else {
        files.set(relative, await readFile(absolute, "utf8"));
      }
    }
  };
  await walk(repoDir, "");
  return files;
}

function hunkFor(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }
  let endBefore = beforeLines.length;
  let endAfter = afterLines.length;
  while (
    endBefore > start &&
    endAfter > start &&
    beforeLines[endBefore - 1] === afterLines[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const removed = beforeLines.slice(start, endBefore);
  const added = afterLines.slice(start, endAfter);
  const lines = [
    `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ];
  return lines.join("\n");
}

/** File-tree diff over a plain directory — git is not required for inspection. */
export function createWorkspaceDiffProvider(repoDir: string): WorkspaceDiffProvider {
  let before: Map<string, string> | undefined;
  return {
    async before() {
      before = await snapshot(repoDir);
    },
    async after(): Promise<WorkspaceDiff> {
      const beforeMap = before ?? new Map();
      const afterMap = await snapshot(repoDir);
      const files: WorkspaceDiff["files"] = [];
      const hunks: string[] = [];
      for (const [filePath, beforeText] of beforeMap) {
        const afterText = afterMap.get(filePath);
        if (afterText === undefined) {
          files.push({ path: filePath, status: "deleted" });
          hunks.push(`diff --git a/${filePath} b/${filePath}\n${hunkFor(beforeText, "")}`);
        } else if (afterText !== beforeText) {
          files.push({ path: filePath, status: "modified" });
          hunks.push(`diff --git a/${filePath} b/${filePath}\n${hunkFor(beforeText, afterText)}`);
        }
      }
      for (const [filePath, afterText] of afterMap) {
        if (!beforeMap.has(filePath)) {
          files.push({ path: filePath, status: "added" });
          hunks.push(`diff --git a/${filePath} b/${filePath}\n${hunkFor("", afterText)}`);
        }
      }
      files.sort((left, right) => left.path.localeCompare(right.path));
      return { files, unified: hunks.join("\n") };
    },
  };
}

export interface VerificationRecord {
  command: string[];
  exitStatus: number;
  artifactId: string;
  at: string;
}

export interface RepoToPrOutcome {
  diff: WorkspaceDiff;
  verification: VerificationRecord[];
  pr: PullRequestResult;
}

export class VerificationFailedError extends Error {
  readonly records: VerificationRecord[];

  constructor(records: VerificationRecord[]) {
    const failed = records.filter((record) => record.exitStatus !== 0);
    super(
      `Verification failed (exit ${failed.map((record) => record.exitStatus).join(", ")}). ` +
        `The pull request was not opened; stopped execution never implies success.`,
    );
    this.name = "VerificationFailedError";
    this.records = records;
  }
}

function splitCommand(command: string): string[] {
  // Verification commands are simple argv lines ("node verify.js"); no shell.
  return command.trim().split(/\s+/);
}

/**
 * Runs the repo-to-PR flow for a coding session. Preconditions are explicit:
 * a recorded acceptance artifact must exist before implement() runs, and the
 * workspace credential must resolve before the PR is attempted.
 */
export async function runRepoToPr(
  deps: {
    prisma: PrismaClient;
    secretStore: EncryptedSecretStore;
    diff: WorkspaceDiffProvider;
    artifacts: ArtifactStore;
    commandRunner: CommandRunner;
    forge: ForgeClient;
  },
  input: {
    sessionId: string;
    repoDir: string;
    implement: () => Promise<void>;
    credentialName?: string;
    headBranch?: string;
    baseBranch?: string;
    prTitle?: string;
  },
): Promise<RepoToPrOutcome> {
  const session = await deps.prisma.codingSession.findUnique({ where: { id: input.sessionId } });
  if (!session) throw new Error(`Coding session "${input.sessionId}" not found`);
  const row = session as unknown as Record<string, unknown>;
  const acceptance = parseAcceptanceRecord(row.acceptance);
  if (!acceptance) {
    throw new Error(
      `Coding session "${input.sessionId}" has no recorded acceptance artifact; ` +
        `agree the outcome and verification commands with the user before implementation.`,
    );
  }
  const credentialName = input.credentialName ?? "github_token";
  const credential = await resolveWorkspaceCredential(deps.prisma, {
    scope: {
      userId: String(row.userId),
      spaceId: String(row.spaceId),
      botId: String(row.botId),
    },
    name: credentialName,
    secretStore: deps.secretStore,
  });

  await deps.diff.before();
  await input.implement();
  const diff = await deps.diff.after();

  const context: AdapterContext = {
    operationId: `coding-verification:${input.sessionId}`,
    traceId: `coding-verification:${input.sessionId}`,
    spaceId: String(row.spaceId),
    userId: String(row.userId),
    signal: new AbortController().signal,
  };
  const verification: VerificationRecord[] = [];
  let failed = false;
  for (const command of acceptance.verificationCommands) {
    const argv = splitCommand(command);
    const result = await deps.commandRunner.run(argv, input.repoDir);
    const evidence = [
      `$ ${command}`,
      `exit status: ${result.exitStatus}`,
      "--- stdout ---",
      result.stdout,
      "--- stderr ---",
      result.stderr,
      "",
    ].join("\n");
    const artifact = await deps.artifacts.put(
      {
        name: `verification-${verification.length + 1}.txt`,
        mimeType: "text/plain",
        bytes: new TextEncoder().encode(evidence),
      },
      context,
    );
    verification.push({
      command: argv,
      exitStatus: result.exitStatus,
      artifactId: artifact.id,
      at: new Date().toISOString(),
    });
    if (result.exitStatus !== 0) failed = true;
  }
  await deps.prisma.codingSession.update({
    where: { id: input.sessionId },
    // Plain-JSON copy: the column is Json; keep the record shape decoupled
    // from the TS interface so the stored form is stable.
    data: { verification: JSON.parse(JSON.stringify(verification)) as never },
  });
  if (failed) throw new VerificationFailedError(verification);

  const pr = await deps.forge.openPullRequest({
    repoDir: input.repoDir,
    headBranch: input.headBranch ?? `coding/${input.sessionId}`,
    baseBranch: input.baseBranch ?? "main",
    title: input.prTitle ?? acceptance.outcome,
    body: [
      acceptance.outcome,
      "",
      "Verification:",
      ...verification.map(
        (record) =>
          `- \`${record.command.join(" ")}\` → exit ${record.exitStatus} (artifact ${record.artifactId})`,
      ),
    ].join("\n"),
    credential,
  });
  return { diff, verification, pr };
}
