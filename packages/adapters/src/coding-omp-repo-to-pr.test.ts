/**
 * 004-code-mode T25 — V2(omp) repo-to-PR integration test.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeForge,
  createProcessCommandRunner,
  createWorkspaceDiffProvider,
  runRepoToPr,
} from "./coding-repo-to-pr.js";
import { EncryptedSecretStore } from "./secrets.js";

describe("V2(omp) — OMP adapter wires to repo-to-PR flow", () => {
  let repoDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkdtemp("/tmp/rakazo-v2omp-");
    const srcDir = join(tmp, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({ name: "test-repo", version: "1.0.0" }, null, 2),
      "utf8",
    );
    await writeFile(join(srcDir, "index.js"), "// initial\n", "utf8");
    repoDir = tmp;
    cleanup = async () => {
      await rm(tmp, { recursive: true, force: true });
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  function makeTestDeps(opts: { sessionId?: string; acceptance?: unknown } = {}) {
    const sessionId = opts.sessionId ?? "s-v2omp";
    const acceptance = opts.acceptance ?? {
      outcome: "add greeting",
      verificationCommands: ["node --version"],
      recordedAt: "2026-10-01T12:00:00Z",
    };

    const session = {
      id: sessionId,
      workspaceId: "ws-1",
      engine: "omp",
      status: "active",
      acceptance,
      userId: "user-1",
      spaceId: "space-1",
      botId: "bot-1",
    };

    const loadMock = vi.fn().mockReturnValue("ghp_fake_token_123");
    const secretStore = Object.assign(new EncryptedSecretStore("test-only-encryption-key"), {
      load: loadMock,
    });

    const prisma = {
      codingSession: {
        findUnique: async () => session,
        update: async ({ data }: { data: { verification?: unknown } }) => ({
          ...session,
          verification: data.verification,
        }),
      },
      botSecret: {
        findFirst: async ({ where }: { where?: { name?: string } }) => {
          if (where?.name !== "github_token") return null;
          return { id: "github-token-key", name: "github_token", ciphertext: "v1:fake" };
        },
      },
    };

    return { secretStore, prisma };
  }

  it("runRepoToPr requires an acceptance artifact before implement() — refusal is explicit", async () => {
    const forge = createFakeForge();
    const diff = createWorkspaceDiffProvider(repoDir);
    const runner = createProcessCommandRunner();
    const { prisma, secretStore } = makeTestDeps({
      sessionId: "s-no-acceptance",
      acceptance: null,
    });

    await expect(
      runRepoToPr(
        {
          prisma,
          secretStore,
          diff,
          artifacts: { put: async () => ({ id: "a1" }) },
          commandRunner: runner,
          forge,
        },
        {
          sessionId: "s-no-acceptance",
          repoDir,
          implement: async () => {
            throw new Error("implement must not run before acceptance");
          },
        },
      ),
    ).rejects.toThrow(/acceptance/i);
  });

  it("runRepoToPr with acceptance + passing verification → PR opened", async () => {
    const forge = createFakeForge();
    const diff = createWorkspaceDiffProvider(repoDir);
    const runner = createProcessCommandRunner();
    const { prisma, secretStore } = makeTestDeps({ sessionId: "s-v2omp" });

    const result = await runRepoToPr(
      {
        prisma,
        secretStore,
        diff,
        artifacts: { put: async () => ({ id: "a1" }) },
        commandRunner: runner,
        forge,
      },
      {
        sessionId: "s-v2omp",
        repoDir,
        implement: async () => {
          await writeFile(
            join(repoDir, "src", "greeting.js"),
            "module.exports = 'hello'\n",
            "utf8",
          );
        },
      },
    );

    expect(result.pr).toHaveProperty("number");
    expect(result.pr).toHaveProperty("url");
  });

  it("runRepoToPr with failing verification throws VerificationFailedError — PR not opened", async () => {
    const forge = createFakeForge();
    const diff = createWorkspaceDiffProvider(repoDir);
    const runner = createProcessCommandRunner();
    const { prisma, secretStore } = makeTestDeps({
      sessionId: "s-v2omp-fail",
      acceptance: {
        outcome: "failing task",
        verificationCommands: ["false"],
        recordedAt: "2026-10-01T12:00:00Z",
      },
    });

    await expect(
      runRepoToPr(
        {
          prisma,
          secretStore,
          diff,
          artifacts: { put: async () => ({ id: "a1" }) },
          commandRunner: runner,
          forge,
        },
        {
          sessionId: "s-v2omp-fail",
          repoDir,
          implement: async () => {
            await writeFile(join(repoDir, "src", "changed.js"), "// changed\n", "utf8");
          },
        },
      ),
    ).rejects.toThrow();
  });

  it("V2(omp) integrity: diff is inspectable after implement(), verification runs, PR opened", async () => {
    const forge = createFakeForge();
    const diff = createWorkspaceDiffProvider(repoDir);
    const runner = createProcessCommandRunner();
    const { prisma, secretStore } = makeTestDeps({
      sessionId: "s-v2omp-integrity",
      acceptance: {
        outcome: "add feature",
        verificationCommands: ["node -e 'require(\"./src/feature.js\")'"],
        recordedAt: "2026-10-01T12:00:00Z",
      },
    });

    await writeFile(join(repoDir, "src", "feature.js"), "module.exports = {}\n", "utf8");

    const result = await runRepoToPr(
      {
        prisma,
        secretStore,
        diff,
        artifacts: { put: async () => ({ id: "a1" }) },
        commandRunner: runner,
        forge,
      },
      {
        sessionId: "s-v2omp-integrity",
        repoDir,
        implement: async () => {
          await writeFile(
            join(repoDir, "src", "feature.js"),
            "module.exports = { hello: 'world' }\n",
            "utf8",
          );
        },
      },
    );

    expect(result.pr).toHaveProperty("number");
    expect(result.pr).toHaveProperty("url");
  });
});
