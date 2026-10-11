/**
 * 004-code-mode S7 T43 — git graph data computed inside the workspace.
 *
 * Runs read-only git argv through the process command runner against a real
 * fixture repo in a temp dir — deterministic and offline. A non-repo must
 * yield a truthful empty state, not an error.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildGitGraph } from "./coding-git-graph.js";
import { createProcessCommandRunner } from "./coding-repo-to-pr.js";

const execFileAsync = promisify(execFile);

const dirs: string[] = [];
afterAllCleanup();
function afterAllCleanup() {
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });
}

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rakazo-git-graph-"));
  dirs.push(dir);
  return dir;
}

async function initRepo(dir: string): Promise<void> {
  const git = async (...argv: string[]) =>
    execFileAsync("git", argv, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  await git("init", "-b", "main");
  await git("config", "user.name", "Test Author");
  await git("config", "user.email", "author@example.test");
  await writeFile(path.join(dir, "a.txt"), "one\n");
  await git("add", "a.txt");
  await git("commit", "-m", "first commit");
  await writeFile(path.join(dir, "a.txt"), "two\n");
  await git("add", "a.txt");
  await git("commit", "-m", "second commit");
  await git("branch", "feature");
  // Leave the worktree dirty.
  await writeFile(path.join(dir, "a.txt"), "three\n");
}

function runnerFor(dir: string) {
  const runner = createProcessCommandRunner();
  return (argv: string[]) => runner.run(argv, dir);
}

describe("git graph (T43)", () => {
  it("reads commits, branch refs, and dirty state from a fixture repo", async () => {
    const dir = await makeDir();
    await initRepo(dir);

    const graph = await buildGitGraph(runnerFor(dir));

    expect(graph.notRepo).toBe(false);
    expect(graph.commits).toHaveLength(2);
    expect(graph.commits[0]?.subject).toBe("second commit");
    expect(graph.commits[0]?.author).toBe("Test Author");
    expect(graph.commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(graph.commits[0]?.parents).toEqual([graph.commits[1]?.sha]);
    expect(graph.commits[1]?.subject).toBe("first commit");
    expect(graph.commits[1]?.parents).toEqual([]);
    expect(graph.commits[1]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(graph.refs).toEqual(expect.arrayContaining(["main", "feature"]));
    expect(graph.dirty).toBe(1);
  });

  it("returns a truthful empty state outside a git repo", async () => {
    const dir = await makeDir();

    const graph = await buildGitGraph(runnerFor(dir));

    expect(graph).toEqual({ commits: [], refs: [], dirty: 0, notRepo: true });
  });
});
