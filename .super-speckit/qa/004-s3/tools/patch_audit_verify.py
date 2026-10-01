"""One-shot S3 audit patch: drop the tautological clause + unused variable.

Verification of one entry = recompute sha256(prev_hash + canonical(fields))
and compare with the stored hash field; canonical is not stored separately,
so no extra comparison exists.
"""
from pathlib import Path

path = Path("packages/adapters/src/coding-secrets-audit.ts")
src = path.read_text()

old = """    const canonical = canonicalJson(parsed);
    if (parsed.prevHash !== prevHash) {"""
new = """    if (parsed.prevHash !== prevHash) {"""
assert old in src, "anchor 1 not found"

old2 = """    if (entryHash(prevHash, parsed) !== parsed.hash || canonical !== canonicalJson(parsed)) {"""
new2 = """    if (entryHash(prevHash, parsed) !== parsed.hash) {"""
assert old2 in src, "anchor 2 not found"

src = src.replace(old, new, 1).replace(old2, new2, 1)
path.write_text(src)
print("audit verify clause fixed")
