import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@rakazo/db";
import { afterEach, describe, expect, it } from "vitest";
import { LocalArtifactStore } from "./artifacts.js";
import {
  createFakeForge,
  createProcessCommandRunner,
  createWorkspaceDiffProvider,
  type FakeForge,
  MissingWorkspaceCredentialError,
  resolveWorkspaceCredential,
  runRepoToPr,
  VerificationFailedError,
} from "./coding-repo-to-pr.js";
import { EncryptedSecretStore } from "./secrets.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

async function fixtureRepo(state: { acceptance?: unknown } = {}) {
  const repoDir = await mkdtemp(path.join(tmpdir(), "rakazo-coding-repo-"));
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "rakazo-coding-artifacts-"));
  cleanup.push(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
  });
  await writeFile(
    path.join(repoDir, "verify.js"),
    "if (process.env.VERIFY_FAIL) { process.exit(1); }\nprocess.exit(0);\n",
  );
  await writeFile(path.join(repoDir, "README.md"), "fixture repo\n");
  const sessions: Array<Record<string, unknown>> = [
    {
      id: "session-1",
      workspaceId: "ws-1",
      engine: "normal-pi",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
      latestRunId: "run-1",
      acceptance: state.acceptance ?? null,
      refusals: 0,
    },
  ];
  const prisma = {
    codingSession: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        sessions.find((row) => row.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: unknown }) => {
        Object.assign(sessions.find((row) => row.id === where.id)!, data);
      },
    },
    botSecret: {
      findFirst: async ({ where }: { where: { name?: string } }) =>
        where.name === "github_token"
          ? {
              name: "github_token",
              origin: "https://github.test",
              auth: { type: "bearer" },
              ...credential,
            }
          : null,
    },
  } as unknown as PrismaClient;
  const secretStore = new EncryptedSecretStore("test-only-encryption-key");
  const credential = await secretStore.put(
    "ghp_fake_token_123",
    {
      operationId: "cred-1",
      traceId: "cred-1",
      spaceId: "space-1",
      userId: "user-1",
      signal: new AbortController().signal,
    },
    "cred-1",
  );
  const diff = createWorkspaceDiffProvider(repoDir);
  await diff.before();
  return {
    repoDir,
    prisma,
    diff,
    artifacts: new LocalArtifactStore(artifactRoot),
    runner: createProcessCommandRunner(),
    secretStore: new EncryptedSecretStore("test-only-encryption-key"),
  };
}

function forgeDouble() {
  const forge: FakeForge = createFakeForge();
  return forge;
}

const acceptance = {
  outcome: "README documents the fixture",
  verificationCommands: ["node verify.js"],
  recordedAt: "2026-10-01T05:00:00.000Z",
};

describe("repo-to-PR flow (T5, V2 pi)", () => {
  it("refuses explicitly before any work when no acceptance artifact is recorded", async () => {
    const { prisma, diff, artifacts, runner, repoDir, secretStore } = await fixtureRepo();
    const forge = forgeDouble();
    await expect(
      runRepoToPr(
        { prisma, secretStore, diff, artifacts, commandRunner: runner, forge },
        {
          sessionId: "session-1",
          repoDir,
          implement: async () => {
            throw new Error("implement must not run before acceptance");
          },
        },
      ),
    ).rejects.toThrow(/acceptance/i);
    expect(forge.calls).toHaveLength(0);
  });

  it("refuses explicitly when the workspace credential is missing (blocker, never bypass)", async () => {
    const { prisma, diff, artifacts, runner, repoDir, secretStore } = await fixtureRepo({
      acceptance,
    });
    const forge = forgeDouble();
    const noCredentialPrisma = {
      botSecret: { findFirst: async () => null },
      codingSession: (prisma as unknown as Record<string, unknown>).codingSession,
    } as unknown as PrismaClient;
    await expect(
      runRepoToPr(
        {
          prisma: noCredentialPrisma,
          secretStore,
          diff,
          artifacts,
          commandRunner: runner,
          forge,
        },
        {
          sessionId: "session-1",
          repoDir,
          implement: async () => {
            await writeFile(path.join(repoDir, "feature.md"), "work\n");
          },
        },
      ),
    ).rejects.toBeInstanceOf(MissingWorkspaceCredentialError);
    expect(forge.calls).toHaveLength(0);
  });

  it("implement → inspectable diff → verification record (command, exit, artifact) → PR via credential", async () => {
    const { prisma, diff, artifacts, runner, repoDir, secretStore } = await fixtureRepo({
      acceptance,
    });
    const forge = forgeDouble();
    const outcome = await runRepoToPr(
      { prisma, secretStore, diff, artifacts, commandRunner: runner, forge },
      {
        sessionId: "session-1",
        repoDir,
        credentialName: "github_token",
        implement: async () => {
          await writeFile(path.join(repoDir, "feature.md"), "the feature\n");
        },
      },
    );
    // Inspectable diff names the edited file.
    expect(outcome.diff.files).toEqual([{ path: "feature.md", status: "added" }]);
    expect(outcome.diff.unified).toContain("feature.md");
    expect(outcome.diff.unified).toContain("the feature");
    // Verification record: real command, real exit status, stored artifact.
    expect(outcome.verification).toHaveLength(1);
    expect(outcome.verification[0]).toMatchObject({
      command: ["node", "verify.js"],
      exitStatus: 0,
    });
    const evidence = await artifacts.get(outcome.verification[0]!.artifactId, {
      spaceId: "space-1",
    } as never);
    expect(new TextDecoder().decode(evidence)).toContain("node verify.js");
    // PR opened through the existing workspace credential.
    expect(forge.calls).toHaveLength(1);
    expect(forge.calls[0]!.credential.token).toBe("ghp_fake_token_123");
    expect(forge.calls[0]!.credential.name).toBe("github_token");
    expect(outcome.pr.url).toContain("pull/1");
    // The verification record is persisted on the session for the web view.
    const sessionRow = await (
      prisma as unknown as {
        codingSession: {
          findUnique: (input: { where: { id: string } }) => Promise<Record<string, unknown>>;
        };
      }
    ).codingSession.findUnique({ where: { id: "session-1" } });
    expect(sessionRow!.verification).toBeTruthy();
  });

  it("a failed verification command is reported and blocks the PR — stopped is not success", async () => {
    const { prisma, diff, artifacts, repoDir, secretStore } = await fixtureRepo({
      acceptance: { ...acceptance, verificationCommands: ["node verify.js"] },
    });
    const forge = forgeDouble();
    const failing = {
      run: async (argv: string[]) => {
        if (argv.includes("verify.js")) {
          return { exitStatus: 1, stdout: "", stderr: "verify failed" };
        }
        return { exitStatus: 0, stdout: "", stderr: "" };
      },
    };
    await writeFile(path.join(repoDir, "feature.md"), "the feature\n");
    await expect(
      runRepoToPr(
        { prisma, secretStore, diff, artifacts, commandRunner: failing, forge },
        {
          sessionId: "session-1",
          repoDir,
          credentialName: "github_token",
          implement: async () => undefined,
        },
      ),
    ).rejects.toBeInstanceOf(VerificationFailedError);
    expect(forge.calls).toHaveLength(0);
  });

  it("resolves the workspace credential through the existing bot-secret facility", async () => {
    const { prisma } = await fixtureRepo();
    const credential = await resolveWorkspaceCredential(prisma, {
      scope: { userId: "user-1", spaceId: "space-1", botId: "bot-1" },
      name: "github_token",
      secretStore: new EncryptedSecretStore("test-only-encryption-key"),
    });
    expect(credential).toMatchObject({ name: "github_token", token: "ghp_fake_token_123" });
  });

  it("the process command runner reports real exit statuses offline", async () => {
    const runner = createProcessCommandRunner();
    const dir = await mkdtemp(path.join(tmpdir(), "rakazo-coding-runner-"));
    cleanup.push(async () => rm(dir, { recursive: true, force: true }));
    await writeFile(path.join(dir, "ok.js"), "process.exit(0);");
    await writeFile(path.join(dir, "bad.js"), "process.exit(3);");
    await expect(runner.run(["node", "ok.js"], dir)).resolves.toMatchObject({ exitStatus: 0 });
    await expect(runner.run(["node", "bad.js"], dir)).resolves.toMatchObject({ exitStatus: 3 });
  });
});

describe("fake forge double", () => {
  it("records PR opens and returns stable offline URLs (no network)", async () => {
    const forge = forgeDouble();
    const pr = await forge.openPullRequest({
      repoDir: "/tmp/repo",
      headBranch: "coding/session-1",
      baseBranch: "main",
      title: "Add feature",
      body: "body",
      credential: { name: "github_token", token: "t" },
    });
    expect(pr.url).toMatch(/pull\/1$/);
    expect(forge.calls[0]!.title).toBe("Add feature");
  });

  it("requires a credential for every PR open", async () => {
    const forge = forgeDouble();
    await expect(
      forge.openPullRequest({
        repoDir: "/tmp/repo",
        headBranch: "b",
        baseBranch: "main",
        title: "t",
        body: "b",
        credential: undefined as never,
      }),
    ).rejects.toThrow(/credential/i);
  });
});

describe("workspace diff provider", () => {
  it("reports added, modified, and deleted files with a unified text", async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), "rakazo-coding-diff-"));
    cleanup.push(async () => rm(repoDir, { recursive: true, force: true }));
    await mkdir(path.join(repoDir, "src"), { recursive: true });
    await writeFile(path.join(repoDir, "src", "a.ts"), "one\n");
    await writeFile(path.join(repoDir, "gone.md"), "bye\n");
    const diff = createWorkspaceDiffProvider(repoDir);
    await diff.before();
    await writeFile(path.join(repoDir, "src", "a.ts"), "one\ntwo\n");
    await writeFile(path.join(repoDir, "new.md"), "hello\n");
    await rm(path.join(repoDir, "gone.md"));
    const after = await diff.after();
    expect(after.files).toEqual(
      expect.arrayContaining([
        { path: "src/a.ts", status: "modified" },
        { path: "new.md", status: "added" },
        { path: "gone.md", status: "deleted" },
      ]),
    );
    expect(after.unified).toContain("diff --git");
    expect(after.unified).toContain("+two");
    const roundtrip = await readFile(path.join(repoDir, "src", "a.ts"), "utf8");
    expect(roundtrip).toContain("two");
  });

  it("runs git-free: works on a plain directory (no .git required)", async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), "rakazo-coding-diff2-"));
    cleanup.push(async () => rm(repoDir, { recursive: true, force: true }));
    const diff = createWorkspaceDiffProvider(repoDir);
    await diff.before();
    const after = await diff.after();
    expect(after.files).toEqual([]);
  });
});
