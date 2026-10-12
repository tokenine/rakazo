import pathlib

p = pathlib.Path("packages/adapters/src/executor-coding-secrets.test.ts")
s = p.read_text()

old = """    const surfaces = [
      ...f.events.append.mock.calls.map((call) => JSON.stringify(call)),
      ...f.events.finalizeRun.mock.calls.map((call) => JSON.stringify(call)),
    ].join("\\n");
    expect(surfaces).not.toContain(PLANTED);"""
new = """    const surfaces = [
      ...f.events.append.mock.calls.map((call) => JSON.stringify(call)),
      ...f.events.finalizeRun.mock.calls.map((call) => JSON.stringify(call)),
    ].join("\\n");
    console.log("APPENDS:", f.events.append.mock.calls.length, "FINALS:", f.events.finalizeRun.mock.calls.length);
    console.log("SURFACES:", surfaces.slice(0, 2000));
    expect(surfaces).not.toContain(PLANTED);"""
assert s.count(old) == 1
s = s.replace(old, new)
p.write_text(s)
print("debug logging added")
