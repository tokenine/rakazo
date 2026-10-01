import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgentHomeStore } from "./home.js";

/**
 * 004-code-mode T11 — versioned workspace store (G2/R7, V5):
 * append-only revision archive replaces `.previous` deletion; dirty-set
 * query; restore honors the SELECTED revision; post-restore manual edits are
 * protected — neither side's work is lost.
 */

const context = {
  operationId: "test",
  traceId: "test",
  spaceId: "workspace",
  userId: "user",
  signal: new AbortController().signal,
};

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "rakazo-home-versions-"));
  dirs.push(root);
  const store = new LocalAgentHomeStore(root);
  return { root, store };
}

async function stagingWith(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "rakazo-home-staging-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content, "utf8");
  }
  return dir;
}

describe("versioned workspace store — append-only revision archive (V5/G2)", () => {
  it("admits it keeps revisions", async () => {
    const { store } = await fixture();
    expect(store.describe().capabilities.revisions).toBe(true);
  });

  it("every commit appends a revision; earlier revisions are never deleted", async () => {
    const { store } = await fixture();
    const r1 = await store.commit("bot-1", await stagingWith({ "a.txt": "one" }), context);
    const r2 = await store.commit("bot-1", await stagingWith({ "a.txt": "two" }), context);
    const r3 = await store.commit("bot-1", await stagingWith({ "a.txt": "three" }), context);
    expect(new Set([r1, r2, r3]).size).toBe(3);

    const revisions = await store.listRevisions("bot-1");
    expect(revisions.map((revision) => revision.id)).toEqual([r1, r2, r3]);
    // The archive is append-only: all three contents survive on disk.
    for (const [revision, expected] of [
      [r1, "one"],
      [r2, "two"],
      [r3, "three"],
    ] as const) {
      const dir = await mkdtemp(path.join(tmpdir(), "rakazo-home-restore-probe-"));
      dirs.push(dir);
      await store.restore("bot-1", revision, dir, context);
      await expect(readFile(path.join(dir, "a.txt"), "utf8")).resolves.toBe(expected);
    }
  });

  it("restore honors the SELECTED revision, including files deleted in later revisions", async () => {
    const { store } = await fixture();
    const r1 = await store.commit(
      "bot-1",
      await stagingWith({ "keep.txt": "old", "dropped-later.txt": "gone" }),
      context,
    );
    const r2 = await store.commit("bot-1", await stagingWith({ "keep.txt": "new" }), context);
    expect(r2).not.toBe(r1);

    const dest = await mkdtemp(path.join(tmpdir(), "rakazo-home-restore-"));
    dirs.push(dest);
    const report = await store.restore("bot-1", r1, dest, context);
    expect(report.restoredRevision).toBe(r1);
    expect(report.restored.sort()).toEqual(["dropped-later.txt", "keep.txt"]);
    await expect(readFile(path.join(dest, "dropped-later.txt"), "utf8")).resolves.toBe("gone");
    await expect(readFile(path.join(dest, "keep.txt"), "utf8")).resolves.toBe("old");
  });

  it("restore protects post-revision manual edits: changed, added, deleted files survive", async () => {
    const { store } = await fixture();
    const r1 = await store.commit(
      "bot-1",
      await stagingWith({ "a.txt": "v1", "sub/b.txt": "bv1", "removed.txt": "bye" }),
      context,
    );

    // Live work after r1: a.txt changed manually, c.txt added, removed.txt
    // deleted. The restore target is the live tree (dest holds its state).
    const dest = await mkdtemp(path.join(tmpdir(), "rakazo-home-restore2-"));
    dirs.push(dest);
    await mkdir(path.join(dest, "sub"), { recursive: true });
    await writeFile(path.join(dest, "a.txt"), "manual edit", "utf8");
    await writeFile(path.join(dest, "c.txt"), "manual addition", "utf8");
    await writeFile(path.join(dest, "sub/b.txt"), "bv1", "utf8");

    const report = await store.restore("bot-1", r1, dest, context);
    expect(report.restoredRevision).toBe(r1);
    // b.txt did not change after r1 → restored (materialized) from r1.
    expect(report.restored).toEqual(["sub/b.txt"]);
    // a.txt changed, c.txt added, removed.txt deleted after r1 → protected.
    expect(report.protected.sort()).toEqual(["a.txt", "c.txt", "removed.txt"]);
    await expect(readFile(path.join(dest, "a.txt"), "utf8")).resolves.toBe("manual edit");
    await expect(readFile(path.join(dest, "c.txt"), "utf8")).resolves.toBe("manual addition");
    await expect(readFile(path.join(dest, "sub/b.txt"), "utf8")).resolves.toBe("bv1");
    await expect(stat(path.join(dest, "removed.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("dirty-set query: changesSince(revision) lists changed, added, and removed paths", async () => {
    const { store } = await fixture();
    const r1 = await store.commit(
      "bot-1",
      await stagingWith({ "same.txt": "x", "changed.txt": "old", "removed.txt": "bye" }),
      context,
    );
    await store.commit(
      "bot-1",
      await stagingWith({ "same.txt": "x", "changed.txt": "new", "added.txt": "hi" }),
      context,
    );
    const dirty = await store.changesSince("bot-1", r1);
    expect(dirty.changed.sort()).toEqual(["changed.txt"]);
    expect(dirty.added.sort()).toEqual(["added.txt"]);
    expect(dirty.removed.sort()).toEqual(["removed.txt"]);
  });

  it("changesSince against the CURRENT revision is empty (no phantom dirt)", async () => {
    const { store } = await fixture();
    const r1 = await store.commit("bot-1", await stagingWith({ "a.txt": "only" }), context);
    const dirty = await store.changesSince("bot-1", r1);
    expect(dirty).toEqual({ changed: [], added: [], removed: [] });
  });

  it("revision archive lives OUTSIDE the bot home and never leaks into exports", async () => {
    const { root, store } = await fixture();
    await store.commit("bot-1", await stagingWith({ "a.txt": "one" }), context);
    const home = store.pathFor("bot-1");
    const entries = await readdir(home);
    expect(entries).toEqual(["a.txt"]);
    const exported = [];
    for await (const file of store.exportHome("bot-1", context)) exported.push(file.path);
    expect(exported).toEqual(["a.txt"]);
    // The archive lives under the store root, not inside homes/bot-1.
    const archiveRoot = path.join(root, "home-revisions", "bot-1");
    const archived = await readdir(path.join(archiveRoot, "revisions"));
    expect(archived.length).toBeGreaterThanOrEqual(1);
  });

  it("checkout still returns the latest state (checkpoint flow unchanged)", async () => {
    const { store } = await fixture();
    await store.commit("bot-1", await stagingWith({ "a.txt": "latest" }), context);
    await store.commit("bot-1", await stagingWith({ "a.txt": "newer" }), context);
    const dest = await mkdtemp(path.join(tmpdir(), "rakazo-home-checkout-"));
    dirs.push(dest);
    // checkout copies the CURRENT (latest) state; its stamp is the interface's
    // "working" marker — revision ids come from commit()/listRevisions().
    const stamp = await store.checkout("bot-1", dest, context);
    expect(stamp).toBe("working");
    await expect(readFile(path.join(dest, "a.txt"), "utf8")).resolves.toBe("newer");
  });

  it("restoring an unknown revision fails explicitly", async () => {
    const { store } = await fixture();
    await store.commit("bot-1", await stagingWith({ "a.txt": "one" }), context);
    const dest = await mkdtemp(path.join(tmpdir(), "rakazo-home-unknown-"));
    dirs.push(dest);
    await expect(store.restore("bot-1", "rev-does-not-exist", dest, context)).rejects.toThrow(
      /unknown revision/i,
    );
  });
});
