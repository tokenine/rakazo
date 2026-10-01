import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  AgentHomeStore,
  PortableFile,
  WorkspaceDirtySet,
  WorkspaceRestoreReport,
  WorkspaceRevisionInfo,
} from "@rakazo/adapter-kit";
import { fileHandlePath } from "./file-handle-path.js";

/**
 * 004-code-mode T13 — checkpoint contents policy (TECHNICAL REMAINDER ONLY).
 * The DEFAULT below still requires user sign-off at the slice review before
 * it is treated as final (same treatment as Q6/Q7); it is isolated here so
 * the review can change it without touching the store mechanics.
 *
 * - node_modules is excluded from checkpoints (restores rebuild deps).
 * - dev-service data (databases, queues, caches under data dirs) is NOT
 *   checkpointed; documented here, not discovered by surprise.
 * - external side effects are reported (see the takeover recheck note and
 *   restore reports), never implied rolled back by a checkpoint/restore.
 */
export const CHECKPOINT_CONTENTS_POLICY = {
  excludedDirectoryNames: ["node_modules"],
  notCheckpointed:
    "dev-service data (databases, queues, caches under data dirs) is not checkpointed",
  externalSideEffects: "external side effects are reported, not implied rolled back (T13 policy)",
} as const;

/** True when a workspace-relative path is excluded from checkpoint contents. */
export function shouldExcludeFromCheckpoint(relative: string): boolean {
  return relative
    .split("/")
    .some((segment) =>
      (CHECKPOINT_CONTENTS_POLICY.excludedDirectoryNames as readonly string[]).includes(segment),
    );
}

export class LocalAgentHomeStore implements AgentHomeStore {
  private readonly botWrites = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}

  describe() {
    return {
      id: "local-fs",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      // 004-code-mode T11: the archive is append-only; restore honors a
      // selected revision and protects newer manual edits.
      capabilities: { revisions: true },
    };
  }

  private botDir(botId: string) {
    if (!botId || botId === "." || botId === ".." || path.basename(botId) !== botId) {
      throw new Error("Invalid bot id");
    }
    return path.join(this.root, "homes", botId);
  }

  pathFor(botId: string) {
    return path.resolve(this.botDir(botId));
  }

  async checkout(botId: string, dest: string, _context: AdapterContext): Promise<string> {
    await this.waitForBotWrite(botId);
    await this.recoverInterruptedCommit(botId);
    await mkdir(dest, { recursive: true });
    const src = this.botDir(botId);
    await mkdir(src, { recursive: true });
    await copyDir(src, dest);
    return "working";
  }

  /**
   * 004-code-mode T11: every commit appends a revision to the archive — the
   * incoming state becomes a new revision and the outgoing state (if any) is
   * archived too. `.previous` remains only as the crash-recovery swap dir;
   * history is never deleted (G2: no more latest-only + `.previous` rm).
   */
  async commit(botId: string, src: string, _context: AdapterContext): Promise<string> {
    return this.withBotWrite(botId, async () => {
      await this.recoverInterruptedCommit(botId);
      const dest = this.botDir(botId);
      const parent = path.dirname(dest);
      const staging = path.join(parent, `.${botId}.staging-${randomUUID()}`);
      const previous = `${dest}.previous`;
      await mkdir(parent, { recursive: true });
      await mkdir(staging, { recursive: true });
      try {
        await copyDir(src, staging);
        // Archive the OUTGOING state before the swap (append-only).
        if (await pathExists(dest)) {
          await this.archiveRevision(botId, dest);
        }
        await rm(previous, { recursive: true, force: true });
        if (await pathExists(dest)) await rename(dest, previous);
        try {
          await rename(staging, dest);
        } catch (error) {
          if (!(await pathExists(dest)) && (await pathExists(previous))) {
            await rename(previous, dest).catch(() => undefined);
          }
          throw error;
        }
        await rm(previous, { recursive: true, force: true });
        // Archive the INCOMING state as the newest revision.
        return this.archiveRevision(botId, dest);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }

  async revise(botId: string): Promise<string> {
    return this.withBotWrite(botId, async () => {
      const dest = this.botDir(botId);
      if (await pathExists(dest)) return this.archiveRevision(botId, dest);
      await this.writeLatestRevisionStamp(botId, "rev-empty");
      return "rev-empty";
    });
  }

  /**
   * Restores the SELECTED revision (V5). Newer live work is protected: paths
   * whose current content differs from the selected revision — changed,
   * added, or deleted after it — are kept as-is and reported, never clobbered
   * (G2/R7: "later manual edits preserved").
   */
  async restore(
    botId: string,
    revision: string,
    dest: string,
    _context: AdapterContext,
  ): Promise<WorkspaceRestoreReport> {
    const manifest = await this.readManifest(botId, revision);
    if (!manifest) throw new Error(`Unknown revision ${JSON.stringify(revision)} for this home`);
    await mkdir(dest, { recursive: true });
    const current = await scanTree(dest);
    // A fresh (empty) target receives the full selected revision; a prepared
    // tree keeps its newer state (post-revision manual edits are protected).
    const freshTarget = Object.keys(current).length === 0;
    const revisionPaths = new Set(Object.keys(manifest.files));
    const restored: string[] = [];
    const protectedPaths: string[] = [];
    for (const [relative, info] of Object.entries(manifest.files)) {
      const live = current[relative];
      if (!freshTarget && live === undefined) {
        // Deleted after the revision — protect the deletion.
        protectedPaths.push(relative);
        continue;
      }
      if (live !== undefined && (live.hash !== info.hash || live.mode !== info.mode)) {
        protectedPaths.push(relative);
        continue;
      }
      const source = path.join(this.revisionDir(botId, revision), relative);
      const target = path.join(dest, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      restored.push(relative);
    }
    for (const relative of Object.keys(current)) {
      if (!revisionPaths.has(relative)) protectedPaths.push(relative);
    }
    return { restoredRevision: revision, restored, protected: protectedPaths };
  }

  /** Append-only revision listing, oldest first (T11). */
  async listRevisions(botId: string): Promise<WorkspaceRevisionInfo[]> {
    const dir = this.manifestDir(botId);
    const entries = await readdir(dir).catch(() => [] as string[]);
    const infos: WorkspaceRevisionInfo[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const manifest = await this.readManifest(botId, entry.slice(0, -".json".length));
      if (manifest) {
        infos.push({
          id: manifest.id,
          seq: manifest.seq,
          createdAt: manifest.createdAt,
          fileCount: Object.keys(manifest.files).length,
          totalBytes: Object.values(manifest.files).reduce((sum, file) => sum + file.size, 0),
        });
      }
    }
    return infos.sort((a, b) => a.seq - b.seq);
  }

  /** Dirty-set query (T11/V5 + T12 pre-resume recheck input). */
  async changesSince(botId: string, revision: string): Promise<WorkspaceDirtySet> {
    const manifest = await this.readManifest(botId, revision);
    if (!manifest) throw new Error(`Unknown revision ${JSON.stringify(revision)} for this home`);
    const dest = this.botDir(botId);
    await mkdir(dest, { recursive: true });
    const current = await scanTree(dest);
    const changed: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    for (const [relative, info] of Object.entries(manifest.files)) {
      const live = current[relative];
      if (live === undefined) removed.push(relative);
      else if (live.hash !== info.hash) changed.push(relative);
    }
    for (const relative of Object.keys(current)) {
      if (!(relative in manifest.files)) added.push(relative);
    }
    return { changed, added, removed };
  }

  async *exportHome(botId: string, _context: AdapterContext): AsyncIterable<PortableFile> {
    await this.waitForBotWrite(botId);
    await this.recoverInterruptedCommit(botId);
    const dir = this.botDir(botId);
    await mkdir(dir, { recursive: true });
    const root = await realpath(dir);
    yield* walkFiles(root, root);
  }

  async readFile(
    botId: string,
    filePath: string,
    _context: AdapterContext,
    options?: { maxBytes?: number },
  ): Promise<string> {
    await this.waitForBotWrite(botId);
    await this.recoverInterruptedCommit(botId);
    const full = await containedExistingPath(this.botDir(botId), filePath);
    const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (options?.maxBytes !== undefined) {
        const info = await handle.stat();
        if (info.size > options.maxBytes) {
          throw new Error(`agent home file exceeds ${options.maxBytes} bytes`);
        }
      }
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  }

  async writeFile(
    botId: string,
    filePath: string,
    content: string,
    _context: AdapterContext,
  ): Promise<void> {
    await this.withBotWrite(botId, async () => {
      await this.recoverInterruptedCommit(botId);
      const full = await containedWritePath(this.botDir(botId), filePath);
      const handle = await open(
        full,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o666,
      );
      try {
        await handle.writeFile(content, "utf8");
      } finally {
        await handle.close();
      }
    });
  }

  async list(botId: string, dirPath: string, _context: AdapterContext) {
    await this.waitForBotWrite(botId);
    await this.recoverInterruptedCommit(botId);
    const root = this.botDir(botId);
    const candidate = safeJoin(root, dirPath);
    const full = await ensureContainedDirectory(root, candidate);
    const entries = await readdir(full, { withFileTypes: true });
    const listed = await Promise.all(
      entries.map(async (entry) => {
        const child = await containedTarget(root, path.join(full, entry.name)).catch(() => null);
        if (!child) return null;
        const info = await stat(child);
        return {
          path: path.posix.join(dirPath.replace(/\\/g, "/"), entry.name),
          kind: info.isDirectory() ? ("dir" as const) : ("file" as const),
          size: info.size,
        };
      }),
    );
    return listed.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  // ---- 004-code-mode T11: append-only revision archive ----

  private archiveRoot(botId: string) {
    return path.join(this.root, "home-revisions", botId);
  }

  private revisionDir(botId: string, revision: string) {
    return path.join(this.archiveRoot(botId), "revisions", revision);
  }

  private manifestDir(botId: string) {
    return path.join(this.archiveRoot(botId), "manifests");
  }

  private async writeLatestRevisionStamp(botId: string, revision: string) {
    const directory = path.join(this.root, "home-revisions");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${botId}.txt`), revision, "utf8");
  }

  /**
   * Archives `dir` as a new revision (content + manifest). Deduplicates
   * against the newest revision: an outgoing state identical to it is already
   * history, so the happy path appends exactly one revision per commit while
   * uncommitted live work still gets captured before an overwrite.
   */
  private async archiveRevision(botId: string, dir: string): Promise<string> {
    const scan = await scanTree(dir);
    const latest = await this.latestManifest(botId);
    if (latest && manifestFilesEqual(latest.files, scan)) return latest.id;
    const existing = await readdir(this.manifestDir(botId)).catch(() => [] as string[]);
    const revision = `rev-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const contentDir = this.revisionDir(botId, revision);
    await mkdir(contentDir, { recursive: true });
    await copyDirFiltered(dir, contentDir);
    const manifest: RevisionManifest = {
      id: revision,
      seq: existing.length + 1,
      createdAt: new Date().toISOString(),
      files: scan,
    };
    await mkdir(this.manifestDir(botId), { recursive: true });
    await writeFile(
      path.join(this.manifestDir(botId), `${revision}.json`),
      JSON.stringify(manifest),
      "utf8",
    );
    await this.writeLatestRevisionStamp(botId, revision);
    return revision;
  }

  private async readManifest(botId: string, revision: string): Promise<RevisionManifest | null> {
    if (!/^[A-Za-z0-9._-]+$/.test(revision) || revision.includes("..")) return null;
    try {
      const raw = await readFile(path.join(this.manifestDir(botId), `${revision}.json`), "utf8");
      const parsed = JSON.parse(raw) as RevisionManifest;
      if (typeof parsed.id !== "string" || typeof parsed.files !== "object") return null;
      return parsed;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async latestManifest(botId: string): Promise<RevisionManifest | null> {
    const entries = await readdir(this.manifestDir(botId)).catch(() => [] as string[]);
    let latest: RevisionManifest | null = null;
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const manifest = await this.readManifest(botId, entry.slice(0, -".json".length));
      if (manifest && (latest === null || manifest.seq > latest.seq)) latest = manifest;
    }
    return latest;
  }

  private async recoverInterruptedCommit(botId: string) {
    const dest = this.botDir(botId);
    const previous = `${dest}.previous`;
    if (!(await pathExists(dest)) && (await pathExists(previous))) await rename(previous, dest);
  }

  private async withBotWrite<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.botWrites.get(botId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Keep the chain alive even when a prior write rejects, so later writers are not stuck
    // behind a permanently rejected predecessor.
    const queued = previous.catch(() => undefined).then(() => current);
    this.botWrites.set(botId, queued);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.botWrites.get(botId) === queued) this.botWrites.delete(botId);
    }
  }

  private async waitForBotWrite(botId: string) {
    await (this.botWrites.get(botId) ?? Promise.resolve());
  }
}

export function resolveAgentHomePath(home: AgentHomeStore, homeKey: string, dataDir = "./data") {
  if (home instanceof LocalAgentHomeStore) return home.pathFor(homeKey);
  return path.resolve(dataDir, "homes", homeKey);
}

function safeJoin(root: string, rel: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, `.${path.sep}${rel.replace(/^\/+/, "")}`);
  assertContained(resolvedRoot, resolved);
  return resolved;
}

async function containedExistingPath(root: string, rel: string) {
  await mkdir(root, { recursive: true });
  const candidate = safeJoin(root, rel);
  return containedTarget(root, candidate);
}

async function containedWritePath(root: string, rel: string) {
  await mkdir(root, { recursive: true });
  const candidate = safeJoin(root, rel);
  const resolvedParent = await ensureContainedDirectory(root, path.dirname(candidate));
  try {
    return await containedTarget(root, path.join(resolvedParent, path.basename(candidate)));
  } catch (error) {
    if (isMissing(error)) return path.join(resolvedParent, path.basename(candidate));
    throw error;
  }
}

async function ensureContainedDirectory(root: string, candidate: string) {
  await mkdir(root, { recursive: true });
  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.resolve(candidate);
  assertContained(lexicalRoot, lexicalCandidate);
  const resolvedRoot = await realpath(root);
  const relative = path.relative(lexicalRoot, lexicalCandidate);
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const next = path.join(current, segment);
    try {
      current = await realpath(next);
    } catch (error) {
      if (!isMissing(error)) throw error;
      await mkdir(next);
      current = await realpath(next);
    }
    assertContained(resolvedRoot, current);
    if (!(await stat(current)).isDirectory()) throw new Error("Path component is not a directory");
  }
  return current;
}

async function containedTarget(root: string, candidate: string) {
  const [resolvedRoot, resolvedTarget] = await Promise.all([realpath(root), realpath(candidate)]);
  assertContained(resolvedRoot, resolvedTarget);
  return resolvedTarget;
}

function assertContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..")
  )
    return;
  throw new Error("Path escapes the bot home");
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// ---- 004-code-mode T11: revision manifest + tree scanning ----

interface RevisionFileMeta {
  hash: string;
  mode: number;
  size: number;
}

interface RevisionManifest {
  id: string;
  seq: number;
  createdAt: string;
  files: Record<string, RevisionFileMeta>;
}

/** Hash+mode+size scan of a home tree, used for manifests and dirty sets. */
async function scanTree(
  root: string,
  current?: string,
  relative = "",
  visited = new Set<string>(),
  into: Record<string, RevisionFileMeta> = {},
): Promise<Record<string, RevisionFileMeta>> {
  const absolute = current ?? (await realpath(root));
  if (visited.has(absolute)) return into;
  visited.add(absolute);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    // T13: excluded directories never enter manifests or dirty sets.
    if (
      entry.isDirectory() &&
      (CHECKPOINT_CONTENTS_POLICY.excludedDirectoryNames as readonly string[]).includes(entry.name)
    ) {
      continue;
    }
    const childPath = path.join(absolute, entry.name);
    if (entry.isSymbolicLink()) {
      // External/escaping links are excluded from manifests exactly as they
      // are from exports (walkFiles hides them too).
      const resolved = await traversalTarget(root, childPath).catch(() => null);
      if (!resolved) continue;
      const info = await stat(resolved);
      if (info.isDirectory()) {
        await scanTree(root, resolved, childRelative, visited, into);
      } else if (info.isFile()) {
        into[childRelative] = await fileMeta(resolved, info);
      }
      continue;
    }
    if (entry.isDirectory()) {
      await scanTree(root, childPath, childRelative, visited, into);
    } else if (entry.isFile()) {
      into[childRelative] = await fileMeta(childPath, await stat(childPath));
    }
  }
  return into;
}

async function fileMeta(absolute: string, info: { mode: number; size: number }) {
  const bytes = await readFile(absolute);
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    mode: info.mode,
    size: info.size,
  };
}

function manifestFilesEqual(
  a: Record<string, RevisionFileMeta>,
  b: Record<string, RevisionFileMeta>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const left = a[key];
    const right = b[key];
    if (left === undefined || right === undefined) return false;
    if (left.hash !== right.hash || left.mode !== right.mode) return false;
  }
  return true;
}

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function traversalTarget(root: string, candidate: string) {
  const resolved = await realpath(candidate);
  assertContained(root, resolved);
  return resolved;
}

async function readTraversalFile(root: string, full: string) {
  const handle = await open(
    full,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Home entry is not a regular file");
    // O_NOFOLLOW only protects the final component. A parent can be swapped
    // during open and restored before any pathname recheck. Check the actual
    // opened object against the root captured once for the entire traversal.
    assertContained(root, await fileHandlePath(handle.fd));
    return { content: await handle.readFile(), mode: info.mode };
  } finally {
    await handle.close();
  }
}

/** copyDir that drops T13-excluded directories (checkpoint contents policy). */
async function copyDirFiltered(
  src: string,
  dest: string,
  sourceRoot?: string,
  visited = new Set<string>(),
) {
  const root = sourceRoot ?? (await realpath(src));
  const current = await traversalTarget(root, src).catch(() => null);
  if (!current || visited.has(current)) return;
  await mkdir(dest, { recursive: true });
  visited.add(current);
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      (CHECKPOINT_CONTENTS_POLICY.excludedDirectoryNames as readonly string[]).includes(entry.name)
    ) {
      continue;
    }
    const from = await traversalTarget(root, path.join(current, entry.name)).catch(() => null);
    if (!from) continue;
    const to = path.join(dest, entry.name);
    const info = await stat(from);
    if (info.isDirectory()) await copyDirFiltered(from, to, root, visited);
    else if (info.isFile()) {
      const file = await readTraversalFile(root, from);
      await writeFile(to, file.content, { mode: file.mode & 0o777 });
    }
  }
}

async function copyDir(
  src: string,
  dest: string,
  sourceRoot?: string,
  visited = new Set<string>(),
) {
  const root = sourceRoot ?? (await realpath(src));
  const current = await traversalTarget(root, src).catch(() => null);
  if (!current || visited.has(current)) return;
  await mkdir(dest, { recursive: true });
  visited.add(current);
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const from = await traversalTarget(root, path.join(current, entry.name)).catch(() => null);
    if (!from) continue;
    const to = path.join(dest, entry.name);
    const info = await stat(from);
    if (info.isDirectory()) await copyDir(from, to, root, visited);
    else if (info.isFile()) {
      const file = await readTraversalFile(root, from);
      await writeFile(to, file.content, { mode: file.mode & 0o777 });
    }
  }
}

async function* walkFiles(
  root: string,
  current: string,
  outputPath = "",
  visited = new Set<string>(),
): AsyncGenerator<PortableFile> {
  const resolvedCurrent = await traversalTarget(root, current).catch(() => null);
  if (!resolvedCurrent || visited.has(resolvedCurrent)) return;
  visited.add(resolvedCurrent);
  const entries = await readdir(resolvedCurrent, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = await traversalTarget(root, path.join(resolvedCurrent, entry.name)).catch(
      () => null,
    );
    if (!full) continue;
    const info = await stat(full);
    const portablePath = path.posix.join(outputPath, entry.name);
    if (info.isDirectory()) {
      yield* walkFiles(root, full, portablePath, visited);
    } else if (info.isFile()) {
      const { content, mode } = await readTraversalFile(root, full);
      yield {
        path: portablePath,
        content: new Uint8Array(content),
        executable: Boolean(mode & 0o100),
      };
    }
  }
}
