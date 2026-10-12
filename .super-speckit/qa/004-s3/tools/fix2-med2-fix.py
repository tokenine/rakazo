import pathlib

p = pathlib.Path("packages/db/src/coding-migration.test.ts")
s = p.read_text()

old = """function isAdditiveCodingColumnAdd(statement: string): boolean {
  const alterMatch =
    /^ALTER TABLE "([A-Za-z_][A-Za-z0-9_]*)" ADD COLUMN "([A-Za-z][A-Za-z0-9_]*)"/.exec(
      statement,
    );
  return (
    alterMatch !== null &&
    NEW_TABLES.has(alterMatch[1]!) &&
    !/\\b(DROP|RENAME|TRUNCATE|UPDATE|DELETE|INSERT|ALTER COLUMN|CONSTRAINT|REFERENCES|NOT NULL|SET|USING)\\b/i.test(
      statement,
    )
  );
}"""
new = """function isAdditiveCodingColumnAdd(statement: string): boolean {
  const alterMatch =
    /^ALTER TABLE "([A-Za-z_][A-Za-z0-9_]*)" ADD COLUMN "([A-Za-z][A-Za-z0-9_]*)"/.exec(
      statement,
    );
  return (
    alterMatch !== null &&
    NEW_TABLES.has(alterMatch[1]!) &&
    !/\\b(DROP|RENAME|TRUNCATE|UPDATE|DELETE|INSERT|ALTER COLUMN|CONSTRAINT|REFERENCES|NOT NULL|SET|USING|DEFAULT|COLLATE|GENERATED|IDENTITY)\\b/i.test(
      statement,
    )
  );
}"""
assert s.count(old) == 1, "helper anchor"
s = s.replace(old, new)

p.write_text(s)
print("med2 fix applied")
