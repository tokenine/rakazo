import pathlib

p = pathlib.Path("packages/adapters/src/coding-secret-grants.test.ts")
s = p.read_text()

# Insert the LOW-5 red test right after the audit-then-act test (same describe).
old = """  it("refuses injection through a provider that cannot guarantee spawn-env injection (T21, structural)", async () => {"""
new = """  it("fix r2 LOW-5: a partial re-grant leaves two grantRefs on one run — each injected name is audited with its OWN row's grantRef", async () => {
    const { grants, dir } = await service();
    const applied: Array<{ taskId: string; keys: string[]; ref: unknown }> = [];
    const provider = {
      applySecretGrant: async (taskId: string, env: Record<string, string>, ref: unknown) => {
        applied.push({ taskId, keys: Object.keys(env), ref });
      },
    };
    // Two SEPARATE grant calls for one run: grant A, then grant B only.
    // The rows now carry two different grantRefs (rows[0] is A's).
    const first = await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    const second = await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["npm_token"],
    });
    expect(first.grantRef).not.toEqual(second.grantRef);
    const outcome = await grants.prepareTaskSecretInjection({
      provider: provider as never,
      taskId: "task-1",
      workspaceId: "ws-1",
      taskRunId: "run-1",
      sessionId: "session-1",
    });
    expect(outcome.injected).toBe(true);
    expect(applied[0]!.keys).toEqual(["github_token", "npm_token"]);
    const verify = await verifySecretsAuditChain({ file: path.join(dir, "audit.jsonl") });
    expect(verify.ok).toBe(true);
    const injectEntryFor = (name: string) =>
      verify.entries.find((entry) => entry.mechanism === "inject" && entry.secretName === name);
    // Per-name attribution: each inject entry stamps ITS OWN row's grantRef —
    // never rows[0]'s ref applied to the whole batch.
    expect(injectEntryFor("github_token")?.grantRef).toEqual(first.grantRef);
    expect(injectEntryFor("npm_token")?.grantRef).toEqual(second.grantRef);
    // The provider batch ref stays a real, auditable grant ref.
    const ref = applied[0]!.ref as { grantRef: string };
    expect(ref.grantRef).toBeTruthy();
  });

  it("refuses injection through a provider that cannot guarantee spawn-env injection (T21, structural)", async () => {"""
assert s.count(old) == 1, "insert anchor"
s = s.replace(old, new)

p.write_text(s)
print("low5 red test added")
