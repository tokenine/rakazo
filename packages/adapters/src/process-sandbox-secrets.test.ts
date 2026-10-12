import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterContext } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ProcessSandboxProvider,
  ProcessSandboxProvider as ProviderClass,
} from "./process-sandbox.js";

/**
 * 004-code-mode S3 — T16 bootstrap injection + the BINDING CONSTRAINT
 * (Chief directive; S2 TRACKING LOW-7).
 *
 * Binding constraint: per-command request.env must be STRUCTURALLY unable to
 * re-inject a grant-gated secret (or any grant-gated value) into a command
 * env without the grant + audit path. Before S3, execute() spread
 * `{ ...task.env, ...request.env }` into scrubProcessEnv's declared-vars
 * argument, and the scrub allowlist covered ONLY the parent env — so ANY
 * per-command env key passed wholesale. These tests pin the fixed behavior:
 *
 *  - request.env may never carry a declared/granted secret NAME (fail
 *    closed with an explicit refusal — no silent strip, no downgrade);
 *  - request.env may never carry a granted secret VALUE under another name;
 *  - granted secrets reach the child ONLY through the audited grant channel
 *    (applySecretGrant), composed OUTSIDE the declared-vars argument;
 *  - ordinary (non-gated) request.env vars still pass, and the parent-env
 *    scrub still holds;
 *  - the injection path writes values to NO tree (V9 grep gate, in-test).
 */

const ctx: AdapterContext = {
  operationId: "test",
  traceId: "test",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
};

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "rakazo-s3-sandbox-"));
  dirs.push(root);
  const provider: ProcessSandboxProvider = new ProviderClass({ root });
  const task = await provider.createTaskContext({
    taskId: "secret-task",
    requiredSecrets: ["github_token", "npm_token"],
    env: { TASK_VAR: "from-task-config" },
  });
  return { root, provider, task };
}

async function collect(generator: AsyncIterable<{ type: string; data?: string; code?: number }>) {
  let stdout = "";
  let stderr = "";
  let code = -1;
  for await (const event of generator) {
    if (event.type === "stdout") stdout += event.data ?? "";
    if (event.type === "stderr") stderr += event.data ?? "";
    if (event.type === "exit") code = event.code ?? -1;
  }
  return { stdout, stderr, code };
}

const GRANT_REF = { grantRef: "grant-test-1", auditHead: { seq: 1, hash: "a".repeat(64) } };

describe("binding constraint: request.env can never re-inject grant-gated secrets (LOW-7)", () => {
  it("refuses a command whose request.env carries a declared secret name — the value never reaches the child", async () => {
    const { provider, task } = await fixture();
    const outcome = await collect(
      provider.execute(
        task.ref,
        {
          argv: ["bash", "-c", 'printf "LEAKED:%s" "$github_token"'],
          env: { github_token: "attacker-controlled-value" },
        },
        ctx,
      ),
    );
    expect(outcome.stdout).not.toContain("attacker-controlled-value");
    expect(outcome.stdout).not.toContain("LEAKED:");
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toMatch(/github_token/);
    expect(outcome.stderr).toMatch(/grant|injection/i);
  });

  it("refuses request.env value collisions: a granted value under another name is still blocked", async () => {
    const { provider, task } = await fixture();
    await provider.applySecretGrant(task.taskId, { github_token: "ghp_grantedvalue" }, GRANT_REF);
    const outcome = await collect(
      provider.execute(
        task.ref,
        {
          argv: ["bash", "-c", 'printf "LEAKED:%s" "$BENIGN_NAME"'],
          env: { BENIGN_NAME: "prefix ghp_grantedvalue suffix" },
        },
        ctx,
      ),
    );
    expect(outcome.stdout).not.toContain("ghp_grantedvalue");
    expect(outcome.stdout).not.toContain("LEAKED:");
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toMatch(/grant/i);
  });

  it("a declared-but-not-yet-granted name is already gated: declaration alone closes the channel", async () => {
    const { provider, task } = await fixture();
    const outcome = await collect(
      provider.execute(
        task.ref,
        {
          argv: ["bash", "-c", 'printf "LEAKED:%s" "$npm_token"'],
          env: { npm_token: "attacker" },
        },
        ctx,
      ),
    );
    expect(outcome.stdout).not.toContain("attacker");
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toMatch(/npm_token/);
  });

  it("no error path silently downgrades: refusal wins even when the command would fail anyway", async () => {
    const { provider, task } = await fixture();
    await provider.applySecretGrant(task.taskId, { github_token: "ghp_grantedvalue" }, GRANT_REF);
    // The command itself is doomed (false); the env refusal must still be the
    // reason it never ran — the attacker value must appear NOWHERE.
    const outcome = await collect(
      provider.execute(
        task.ref,
        {
          argv: ["bash", "-c", "false && printf '%s' \"$github_token\""],
          env: { github_token: "attacker-controlled-value" },
        },
        ctx,
      ),
    );
    expect(outcome.stdout).not.toContain("attacker-controlled-value");
    expect(outcome.stderr).toMatch(/github_token/);
  });

  it("ordinary (non-gated) request.env still passes; parent-env scrub still holds", async () => {
    const { provider, task } = await fixture();
    const outcome = await collect(
      provider.execute(
        task.ref,
        {
          argv: [
            "bash",
            "-c",
            'printf "var=%s taskvar=%s canary=%s" "$MY_LOCAL_VAR" "$TASK_VAR" "$CODE_MODE_S3_CANARY"',
          ],
          env: { MY_LOCAL_VAR: "hello" },
        },
        { ...ctx, signal: ctx.signal } as AdapterContext,
      ),
    );
    expect(outcome.stdout).toContain("var=hello");
    expect(outcome.stdout).toContain("taskvar=from-task-config");
    expect(outcome.stdout).not.toContain("canary=leak");
  });
});

describe("T16: bootstrap injection at process spawn env, via the audited grant channel only", () => {
  it("applySecretGrant injects granted values into the child env (and only those)", async () => {
    const { provider, task } = await fixture();
    await provider.applySecretGrant(task.taskId, { github_token: "ghp_grantedvalue" }, GRANT_REF);
    const outcome = await collect(
      provider.execute(
        task.ref,
        {
          argv: [
            "bash",
            "-c",
            'if [ -n "$github_token" ] && [ -z "$npm_token" ]; then echo injected-present; fi',
          ],
        },
        ctx,
      ),
    );
    expect(outcome.stdout).toContain("injected-present");
  });

  it("applySecretGrant refuses keys outside the task's declared secret names", async () => {
    const { provider, task } = await fixture();
    await expect(
      provider.applySecretGrant(task.taskId, { undeclared_name: "x" }, GRANT_REF),
    ).rejects.toThrow(/declared/);
  });

  it("applySecretGrant refuses to act without the grant + audit reference", async () => {
    const { provider, task } = await fixture();
    await expect(
      provider.applySecretGrant(
        task.taskId,
        { github_token: "ghp_x" },
        {
          grantRef: "",
          auditHead: { seq: 0, hash: "" },
        },
      ),
    ).rejects.toThrow(/grant|audit/i);
    await expect(
      provider.applySecretGrant(task.taskId, { github_token: "ghp_x" }, undefined as never),
    ).rejects.toThrow(/grant|audit/i);
  });

  it("clearSecretGrant removes the injected values for subsequent spawns", async () => {
    const { provider, task } = await fixture();
    await provider.applySecretGrant(task.taskId, { github_token: "ghp_grantedvalue" }, GRANT_REF);
    await provider.clearSecretGrant(task.taskId);
    const outcome = await collect(
      provider.execute(
        task.ref,
        { argv: ["bash", "-c", 'if [ -z "$github_token" ]; then echo cleared; fi'] },
        ctx,
      ),
    );
    expect(outcome.stdout).toContain("cleared");
  });

  it("the injection path writes values to NO tree: workspace, data and provider root stay clean (V9, in-test grep gate)", async () => {
    const { provider, task, root } = await fixture();
    await provider.applySecretGrant(task.taskId, { github_token: "ghp_treevalue" }, GRANT_REF);
    await collect(provider.execute(task.ref, { argv: ["bash", "-c", "true"] }, ctx));
    const { readFile } = await import("node:fs/promises");
    const hits: string[] = [];
    async function scan(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(full);
        } else {
          const content = await readFile(full, "utf8").catch(() => "");
          if (content.includes("ghp_treevalue")) hits.push(full);
        }
      }
    }
    await scan(root);
    expect(hits).toEqual([]);
  });
});
