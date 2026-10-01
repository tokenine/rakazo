import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgentHomeStore } from "./home.js";
import {
  DESKTOP_HELD_FOR_TAKEOVER_MESSAGE,
  recheckWorkspaceAgainstTakeoverBaseline,
  settleForTakeover,
  TAKEOVER_SETTLE_BOUND_MS,
  takeoverHeldToolMessage,
} from "./takeover-settle.js";

/**
 * 004-code-mode T12 — takeover settle mechanics (V4): signal → bounded wait →
 * recorded exit for in-flight guarded work; pre-resume workspace recheck vs
 * the takeover baseline; explicit held messages for the four guarded handlers
 * (shell, write_file, schedule_create, add_mcp_server).
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

describe("settle: signal → bounded wait → recorded exit", () => {
  it("completes within the bound: work is kept and the exit is recorded", async () => {
    const takeover = new AbortController();
    const started = Date.now();
    const settlement = await settleForTakeover(
      async (signal) => {
        expect(signal.aborted).toBe(false);
        return "work-done";
      },
      { takeover: takeover.signal, boundMs: 200 },
    );
    expect(settlement.outcome).toBe("completed");
    if (settlement.outcome === "completed") {
      expect(settlement.value).toBe("work-done");
      expect(settlement.recordedExit).toBe("ok");
    }
    expect(settlement.waitedMs).toBeLessThan(200);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("times out at the bound: the operation is signalled, the wait is bounded, the exit is recorded as unconfirmed", async () => {
    const takeover = new AbortController();
    const settle = settleForTakeover(
      (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => resolve("too-late"), { once: true });
        }),
      { takeover: takeover.signal, boundMs: 80 },
    );
    const settlement = await settle;
    expect(settlement.outcome).toBe("settled-timeout");
    expect(settlement.recordedExit).toBe("unconfirmed");
    expect(settlement.waitedMs).toBeGreaterThanOrEqual(60);
  });

  it("never waits unbounded even without a takeover firing", async () => {
    const settlement = await settleForTakeover(() => new Promise<string>(() => undefined), {
      takeover: new AbortController().signal,
      boundMs: 60,
    });
    expect(settlement.outcome).toBe("settled-timeout");
    expect(settlement.waitedMs).toBeLessThan(2000);
  });

  it("the default bound is a constant (documented, not magic)", () => {
    expect(TAKEOVER_SETTLE_BOUND_MS).toBeGreaterThan(0);
    expect(Number.isFinite(TAKEOVER_SETTLE_BOUND_MS)).toBe(true);
  });
});

describe("held-tool disclosure for the four guarded handlers", () => {
  it("every guarded handler gets an explicit, tool-named held message", () => {
    for (const tool of ["shell", "write_file", "schedule_create", "add_mcp_server"]) {
      const message = takeoverHeldToolMessage(tool);
      expect(message).toContain(tool);
      expect(message).toMatch(/takeover/i);
      expect(message).toMatch(/held|blocked/i);
    }
  });

  it("the desktop held message no longer claims file and shell tools work", () => {
    expect(DESKTOP_HELD_FOR_TAKEOVER_MESSAGE).not.toMatch(/File and shell tools still work/i);
    expect(DESKTOP_HELD_FOR_TAKEOVER_MESSAGE).toMatch(/takeover|held|screen/i);
  });
});

describe("pre-resume workspace recheck vs takeover baseline", () => {
  async function fixtureHome() {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-takeover-recheck-"));
    dirs.push(root);
    return { root, home: new LocalAgentHomeStore(root) };
  }

  async function staging(files: Record<string, string>) {
    const dir = await mkdtemp(path.join(tmpdir(), "rakazo-takeover-staging-"));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(dir, name), content, "utf8");
    }
    return dir;
  }

  it("no divergence: clean resume, no protection note", async () => {
    const { home } = await fixtureHome();
    const baseline = await home.commit("bot-1", await staging({ "a.txt": "committed" }), context);
    const recheck = await recheckWorkspaceAgainstTakeoverBaseline(home, {
      homeKey: "bot-1",
      homeRevision: baseline,
    });
    expect(recheck).toBeDefined();
    expect(recheck?.diverged).toBe(false);
    expect(recheck?.note).toBe("");
  });

  it("manual edits during the hold diverge from the baseline and are reported as protected", async () => {
    const { home } = await fixtureHome();
    const baseline = await home.commit("bot-1", await staging({ "a.txt": "committed" }), context);
    // The user edits while holding the screen; the next checkpoint records it.
    await home.commit("bot-1", await staging({ "a.txt": "manual edit", "b.txt": "new" }), context);
    const recheck = await recheckWorkspaceAgainstTakeoverBaseline(home, {
      homeKey: "bot-1",
      homeRevision: baseline,
    });
    expect(recheck?.diverged).toBe(true);
    expect(recheck?.changedPaths.sort()).toEqual(["a.txt", "b.txt"]);
    expect(recheck?.note).toMatch(/protected/i);
    expect(recheck?.note).toMatch(/not rolled back|not implied/i);
  });

  it("an unusable baseline (unknown revision / none recorded) skips the recheck instead of guessing", async () => {
    const { home } = await fixtureHome();
    expect(
      await recheckWorkspaceAgainstTakeoverBaseline(home, { homeKey: "bot-1", homeRevision: null }),
    ).toBeUndefined();
    await expect(
      recheckWorkspaceAgainstTakeoverBaseline(home, {
        homeKey: "bot-1",
        homeRevision: "rev-from-another-world",
      }),
    ).rejects.toThrow(/unknown revision/i);
  });
});
