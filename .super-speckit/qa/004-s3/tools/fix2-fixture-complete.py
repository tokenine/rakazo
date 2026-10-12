import pathlib

p = pathlib.Path("packages/adapters/src/executor-coding-secrets.test.ts")
s = p.read_text()

# remove debug logging (idempotent)
old = """    console.log("APPENDS:", f.events.append.mock.calls.length, "FINALS:", f.events.finalizeRun.mock.calls.length);
    console.log("SURFACES:", surfaces.slice(0, 2000));
    expect(surfaces).not.toContain(PLANTED);"""
new = """    expect(surfaces).not.toContain(PLANTED);"""
if s.count(old) == 1:
    s = s.replace(old, new)

# prisma mock: add computer model (workspace checkpoint records homeRevision)
old = """    taughtSkill: { findMany: vi.fn(async () => []) },"""
new = """    computer: { updateMany: vi.fn(async () => ({ count: 1 })) },
    taughtSkill: { findMany: vi.fn(async () => []) },"""
assert s.count(old) == 1, "prisma anchor"
s = s.replace(old, new)

# sandbox mock: exportWorkspace async generator (empty workspace)
old = """      execute: async function* () {
        yield { type: "stdout" as const, data: shellOutput };
        yield { type: "exit" as const, code: 0 };
      },"""
new = """      execute: async function* () {
        yield { type: "stdout" as const, data: shellOutput };
        yield { type: "exit" as const, code: 0 };
      },
      exportWorkspace: async function* () {},"""
assert s.count(old) == 1, "sandbox anchor"
s = s.replace(old, new)

# home mock: commit returns a revision
old = """    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    home: undefined,"""
new = """    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    home: { commit: async () => "rev-mock-fixture" },"""
assert s.count(old) == 1, "home anchor"
s = s.replace(old, new)

p.write_text(s)
print("fixture completed OK")
