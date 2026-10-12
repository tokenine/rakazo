import pathlib

p = pathlib.Path("packages/adapters/src/executor.ts")
s = p.read_text()

old = """            if (codingEgressValues.length > 0) {
              const egress = new SecretEgressFilter([...runSecrets, ...codingEgressValues]);
              return finish(egress.filterCommandResult(result));
            }"""
new = """            if (codingEgressValues.length > 0) {
              // S3 fix r2 (MED-1): the granted values ALSO ride runSecrets, so
              // the existing literal redactors cover transcripts, progress,
              // review payloads, and memory from this point on. TRANSFORM
              // coverage (base64/hex/percent) stays scoped to coding shell
              // results (below) and checkpoints (home egressFilter) until S5
              // wires the full egress path — see the EVIDENCE S5 wiring item.
              const additions = codingEgressValues.filter(
                (value) => !runSecrets.includes(value),
              );
              if (additions.length > 0) {
                runSecrets.push(...additions);
                progressRedactor = createStreamingRedactor(runSecrets);
              }
              const egress = new SecretEgressFilter([...runSecrets, ...codingEgressValues]);
              return finish(egress.filterCommandResult(result));
            }"""
assert s.count(old) == 1, "executor shell branch anchor"
s = s.replace(old, new)

p.write_text(s)
print("executor MED-1 fix applied")
