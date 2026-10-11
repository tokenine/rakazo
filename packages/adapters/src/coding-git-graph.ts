/**
 * 004-code-mode S7 T43 — git graph data for the workspace shell side panel.
 *
 * Read-only git argv only (log / for-each-ref / status), executed through a
 * command runner inside the session's workspace. A workspace that is not a
 * git repository yields a truthful empty state (`notRepo: true`) — the panel
 * simply has no content, which is not an error.
 */

export interface GitGraphCommit {
  sha: string;
  parents: string[];
  subject: string;
  author: string;
  date: string;
}

export interface GitGraph {
  commits: GitGraphCommit[];
  refs: string[];
  dirty: number;
  notRepo: boolean;
}

/** Minimal runner shape — matches coding-repo-to-pr's CommandRunner.run. */
export type GitCommandRunner = (argv: string[]) => Promise<{ exitStatus: number; stdout: string }>;

/** Field separator / record separator for --pretty=format (unit + record). */
const FIELD = "\x1f";
const RECORD = "\x1e";
const LOG_FORMAT = ["%H", "%P", "%s", "%an", "%aI"].join(FIELD);
const COMMIT_LIMIT = 50;

export async function buildGitGraph(run: GitCommandRunner): Promise<GitGraph> {
  const inside = await run(["git", "rev-parse", "--is-inside-work-tree"]);
  if (inside.exitStatus !== 0 || !inside.stdout.includes("true")) {
    return { commits: [], refs: [], dirty: 0, notRepo: true };
  }

  const log = await run([
    "git",
    "log",
    `-${COMMIT_LIMIT}`,
    `--pretty=format:${LOG_FORMAT}${RECORD}`,
  ]);
  const commits = log.stdout
    .split(RECORD)
    .map((entry) => entry.replace(/^\n/, ""))
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => {
      const [sha = "", parents = "", subject = "", author = "", date = ""] = entry.split(FIELD);
      return {
        sha,
        parents: parents.split(" ").filter(Boolean),
        subject,
        author,
        date,
      };
    });

  const refs = await run(["git", "for-each-ref", "refs/heads", "--format=%(refname:short)"]);
  const status = await run(["git", "status", "--porcelain"]);
  const dirty = status.stdout.split("\n").filter((line) => line.trim().length > 0).length;

  return {
    commits,
    refs: refs.stdout.split("\n").filter(Boolean),
    dirty,
    notRepo: false,
  };
}
