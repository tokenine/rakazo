import pathlib

p = pathlib.Path("packages/adapters/src/executor-coding-secrets.test.ts")
s = p.read_text()

old = """    expect(stdout).toContain(`b64:${Buffer.from(PLANTED).toString("base64")}`);
  });
});

  it("fix r2 MED-1:"""
new = """    expect(stdout).toContain(`b64:${Buffer.from(PLANTED).toString("base64")}`);
  });

  it("fix r2 MED-1:"""
assert s.count(old) == 1
s = s.replace(old, new)
p.write_text(s)
print("fixed OK")
