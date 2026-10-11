// Run with: pnpm exec tsx docs/research/resource-work-probe.mjs
// Counts work/output only. This is not a latency or physical disk benchmark.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalAgentHomeStore } from "../../packages/adapters/src/home.ts";
import { loadAgentMemoryContext } from "../../packages/adapters/src/memory-context.ts";

const context = {
  operationId: "synthetic-probe",
  traceId: "synthetic-probe",
  spaceId: "fake-space",
  userId: "fake-user",
  botId: "fake-bot",
  signal: new AbortController().signal,
};

const memoryResults = [];
for (const documentsPerScope of [100, 1000]) {
  let documentsReturned = 0;
  let contentBytesReturned = 0;
  const memory = {
    async read({ scope }) {
      const documents = Array.from({ length: documentsPerScope }, (_, index) => ({
        id: `${scope}-${index}`,
        path: `${index}.md`,
        content: "x".repeat(1024),
        revision: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
      documentsReturned += documents.length;
      contentBytesReturned += documents.reduce(
        (sum, document) => sum + Buffer.byteLength(document.content),
        0,
      );
      return { documents };
    },
  };
  const result = await loadAgentMemoryContext(memory, context.botId, context);
  const outputBytes = Buffer.byteLength(result);
  assert.equal(documentsReturned, documentsPerScope * 2);
  assert.ok(outputBytes <= 32 * 1024);
  assert.ok(result.endsWith("</durable_memory>"));
  memoryResults.push({ documentsReturned, contentBytesReturned, outputBytes });
}

async function logicalBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await logicalBytes(file) : (await stat(file)).size;
  }
  return bytes;
}

const root = await mkdtemp(path.join(os.tmpdir(), "rakazo-resource-probe-"));
let workspaceResult;
try {
  const home = new LocalAgentHomeStore(root);
  const working = home.pathFor(context.botId);
  await mkdir(working, { recursive: true });
  const fileCount = 8;
  const fileBytes = 128 * 1024;
  for (let index = 0; index < fileCount; index += 1) {
    await writeFile(path.join(working, `${index}.bin`), Buffer.alloc(fileBytes, index));
  }
  const initialRevision = await home.revise(context.botId);
  assert.equal(await home.revise(context.botId), initialRevision);
  const edits = 6;
  for (let edit = 0; edit < edits; edit += 1) {
    const bytes = Buffer.alloc(fileBytes, 0);
    bytes[0] = edit + 1;
    await writeFile(path.join(working, "0.bin"), bytes);
    await home.revise(context.botId);
  }
  const revisions = await home.listRevisions(context.botId);
  const archivedBytes = await logicalBytes(
    path.join(root, "home-revisions", context.botId, "revisions"),
  );
  assert.equal(revisions.length, edits + 1);
  assert.equal(archivedBytes, (edits + 1) * fileCount * fileBytes);
  workspaceResult = {
    workspaceLogicalBytes: fileCount * fileBytes,
    bytesChangedAcrossEdits: edits,
    revisions: revisions.length,
    archivedLogicalBytes: archivedBytes,
    unchangedRevisionDeduplicated: true,
  };
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ memoryResults, workspaceResult }, null, 2));
