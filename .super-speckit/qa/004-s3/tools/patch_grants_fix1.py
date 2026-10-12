"""One-shot S3 patch: grants test fixture + disclosure phrasing fixes."""
from pathlib import Path

# 1. disclosure: use the plan's exact "same-UID" phrasing.
p1 = Path("packages/adapters/src/coding-secret-grants.ts")
s1 = p1.read_text()
old1 = (
    'values are injected into the task\'s spawn environment, where any process running as '
    'the same UID can read them.'
)
new1 = (
    'values are injected into the task\'s spawn environment, where any same-UID '
    'process can read them.'
)
assert old1 in s1, "disclosure anchor not found"
p1.write_text(s1.replace(old1, new1, 1))

# 2. grants test fixture: the prisma double needs codingSession.update for the
#    run-record head checkpoint.
p2 = Path("packages/adapters/src/coding-secret-grants.test.ts")
s2 = p2.read_text()
old2 = """  const grants = createSecretsGrantsService({
    prisma: grantsClient.prisma as never,"""
new2 = """  const sessionUpdates: Array<Record<string, unknown>> = [];
  const grants = createSecretsGrantsService({
    prisma: {
      codingSecretGrant: (grantsClient.prisma as Record<string, unknown>).codingSecretGrant,
      codingSession: {
        update: async (args: Record<string, unknown>) => {
          sessionUpdates.push(args);
          return {};
        },
      },
    } as never,"""
assert old2 in s2, "fixture anchor not found"
s2 = s2.replace(old2, new2, 1)
old3 = "  return { grants, dir, grantRows: grantsClient.grantRows };"
new3 = "  return { grants, dir, grantRows: grantsClient.grantRows, sessionUpdates };"
assert old3 in s2, "fixture return anchor not found"
p2.write_text(s2.replace(old3, new3, 1))
print("patches applied")
