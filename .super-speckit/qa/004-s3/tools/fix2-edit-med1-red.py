import pathlib

p = pathlib.Path("packages/adapters/src/executor-coding-secrets.test.ts")
s = p.read_text()

# 1. fixture signature: add finalText option
old = "async function fixture(options: { trigger: string; mkdtempDir: string }) {"
new = """async function fixture(options: {
  trigger: string;
  mkdtempDir: string;
  /** Final done-text the runtime yields AFTER the shell call (transcript surface). */
  finalText?: string;
}) {"""
assert s.count(old) == 1
s = s.replace(old, new)

# 2. hoist events + runtimeRun yields finalText
old = """  const results: unknown[] = [];
  const run = {"""
new = """  const results: unknown[] = [];
  const events = {
    append: vi.fn(async () => undefined),
    pauseRunForInput: vi.fn(async () => {
      run.status = "waiting_input";
      return true;
    }),
    finalizeRun: vi.fn(async () => ({ continuationRunId: null })),
  };
  const run = {"""
assert s.count(old) == 1
s = s.replace(old, new)

old = """  const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
    const result = await request.executeTool!("shell", { command: "printenv" }, "call-1");
    results.push(result);
    yield { type: "done" as const, text: "Done" };
  });"""
new = """  const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
    const result = await request.executeTool!("shell", { command: "printenv" }, "call-1");
    results.push(result);
    yield { type: "done" as const, text: options.finalText ?? "Done" };
  });"""
assert s.count(old) == 1
s = s.replace(old, new)

old = """    events: {
      append: vi.fn(async () => undefined),
      pauseRunForInput: vi.fn(async () => {
        run.status = "waiting_input";
        return true;
      }),
      finalizeRun: vi.fn(async () => ({ continuationRunId: null })),
    },"""
new = """    events,"""
assert s.count(old) == 1
s = s.replace(old, new)

old = """  return {
    results,
    async run() {
      await executor.continueRun(run.id, "worker-1");
    },
  };
}"""
new = """  return {
    results,
    events,
    async run() {
      await executor.continueRun(run.id, "worker-1");
    },
  };
}"""
assert s.count(old) == 1
s = s.replace(old, new)

# 3. add the MED-1 red test: close describe after it, add new test, keep helper
old = """function mkdtemp0(): Promise<string> {"""
new = """  it("fix r2 MED-1: a granted value echoed into the transcript AFTER a coding shell call is redacted (runSecrets egress push)", async () => {
    // The shell call happens first; the coding branch must push the granted
    // values into runSecrets so the EXISTING literal redactors (transcript
    // blocks, notification body, progress, review payloads, memory) cover
    // them. Before the fix the value leaks onto the transcript verbatim.
    const f = await fixture({
      trigger: CODING_SESSION_TRIGGER,
      mkdtempDir: await mkdtemp0(),
      finalText: "transcript-echo:" + PLANTED,
    });
    await f.run();
    const surfaces = [
      ...f.events.append.mock.calls.map((call) => JSON.stringify(call)),
      ...f.events.finalizeRun.mock.calls.map((call) => JSON.stringify(call)),
    ].join("\\n");
    expect(surfaces).not.toContain(PLANTED);
  });
});

function mkdtemp0(): Promise<string> {"""
assert s.count(old) == 1
s = s.replace(old, new)

p.write_text(s)
print("edited OK")
