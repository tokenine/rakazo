"""One-shot S3 patch: executor secrets test missing fs import."""
from pathlib import Path

path = Path("packages/adapters/src/executor-coding-secrets.test.ts")
src = path.read_text()
old = """import type { AgentRunRequest, ConnectorTool } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";"""
new = """import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRunRequest, ConnectorTool } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";"""
assert old in src
src = src.replace(old, new, 1)

old2 = """async function mkdtemp0(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  return mkdtemp(path.join(tmpdir(), "rakazo-s3-executor-"));
}"""
new2 = """function mkdtemp0(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "rakazo-s3-executor-"));
}"""
assert old2 in src
path.write_text(src.replace(old2, new2, 1))
print("imports fixed")
