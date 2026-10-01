import pathlib

p = pathlib.Path("packages/adapters/src/executor-coding-secrets.test.ts")
s = p.read_text()
old = 'finalText: "transcript-echo:" + PLANTED,'
new = "finalText: `transcript-echo:${PLANTED}`,"
assert s.count(old) == 1
s = s.replace(old, new)
p.write_text(s)
print("template OK")
