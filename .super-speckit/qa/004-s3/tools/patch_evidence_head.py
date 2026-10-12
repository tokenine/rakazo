"""One-shot S3 patch: EVIDENCE.md final HEAD corrected to the evidence commit."""
from pathlib import Path

path = Path(".super-speckit/qa/004-s3/EVIDENCE.md")
src = path.read_text()
old = """Final HEAD SHA: **`ec81b0a5`** (see commit list below; `apps/web` untouched — `git diff 1c0bb347..HEAD --stat -- apps/web` is empty)"""
new = """Final HEAD SHA: **`222a491a`** (implementation HEAD `ec81b0a5` + this evidence commit;
see commit list below; `apps/web` untouched — `git diff 1c0bb347..HEAD --stat -- apps/web` is empty)"""
assert old in src
src = src.replace(old, new, 1)
old2 = """7. `ec81b0a5` — s3: T21 doctor delegation + flow test + V9 grep gate (3+1 tests)"""
new2 = """7. `ec81b0a5` — s3: T21 doctor delegation + flow test + V9 grep gate (3+1 tests)
8. `222a491a` — s3: S3 evidence (EVIDENCE.md + validate transcript + patch provenance)"""
assert old2 in src
path.write_text(src.replace(old2, new2, 1))
print("evidence head fixed")
