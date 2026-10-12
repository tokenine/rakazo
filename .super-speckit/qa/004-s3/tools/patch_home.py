"""One-shot S3 patch: home.ts checkpoint egress hook (T17), clean copyDir."""
from pathlib import Path

path = Path("packages/adapters/src/home.ts")
src = path.read_text()

# 1. imports (actual form: createHash+randomUUID on one line)
old = """import { createHash, randomUUID } from "node:crypto";"""
assert old in src, "crypto import anchor missing"
new = """import { createHash, randomUUID } from "node:crypto";
import type { SecretEgressFilter } from "./coding-secrets-egress.js";"""
src = src.replace(old, new, 1)

# 2. constructor options
old = """export class LocalAgentHomeStore implements AgentHomeStore {
  private readonly botWrites = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}"""
new = """export interface LocalAgentHomeStoreOptions {
  /**
   * S3 (T17): when present, checkpoint file contents are passed through the
   * deny-list egress filter (literal + base64/hex/URL of granted values)
   * BEFORE hashing/archiving, so revisions never store a secret variant.
   * The filter applies to UTF-8 files up to 1 MiB; binaries pass unchanged.
   */
  egressFilter?: SecretEgressFilter;
}

export class LocalAgentHomeStore implements AgentHomeStore {
  private readonly botWrites = new Map<string, Promise<void>>();

  constructor(
    private readonly root: string,
    private readonly opts: LocalAgentHomeStoreOptions = {},
  ) {}"""
assert old in src, "constructor anchor missing"
src = src.replace(old, new, 1)

# 3. commit(): filter content while copying into staging (before scanTree hashing)
old = """      try {
        await copyDir(src, staging);
        // Archive the OUTGOING state before the swap (append-only)."""
new = """      try {
        // S3 (T17): the egress filter runs BEFORE hashing/archiving so the
        // manifest hashes describe the FILTERED content that is stored.
        await copyDir(src, staging, undefined, undefined, (_relative, content) =>
          this.opts.egressFilter ? this.opts.egressFilter.filterFileContent(content) : content,
        );
        // Archive the OUTGOING state before the swap (append-only)."""
assert old in src, "commit anchor missing"
src = src.replace(old, new, 1)

# 4. copyDir gains the per-file transform (exact original body)
old = """async function copyDir(
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
}"""
new = """async function copyDir(
  src: string,
  dest: string,
  sourceRoot?: string,
  visited = new Set<string>(),
  transform?: (relative: string, content: Uint8Array) => Uint8Array,
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
    if (info.isDirectory()) await copyDir(from, to, root, visited, transform);
    else if (info.isFile()) {
      const file = await readTraversalFile(root, from);
      const content = transform ? transform(entry.name, file.content) : file.content;
      await writeFile(to, content, { mode: file.mode & 0o777 });
    }
  }
}"""
assert old in src, "copyDir anchor missing"
src = src.replace(old, new, 1)

path.write_text(src)
print("home patched (clean)")
