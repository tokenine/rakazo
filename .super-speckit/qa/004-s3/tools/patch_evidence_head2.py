"""One-shot S3 patch: EVIDENCE.md avoids the self-referential final-SHA line."""
from pathlib import Path

path = Path(".super-specit/qa/004-s3/EVIDENCE.md")
path = Path(".super-speckit/qa/004-s3/EVIDENCE.md")
src = path.read_text()
old = """Final HEAD SHA: **`222a491a`** (implementation HEAD `ec81b0a5` + this evidence commit;
see commit list below; `apps/web` untouched — `git diff 1c0bb347..HEAD --stat -- apps/web` is empty)"""
new = """Final HEAD SHA: the tip of `tl/004-purpose-gate-r1` at lane end (reported in the lane
message; the last commits are evidence-only). Implementation tip: **`ec81b0a5`**;
evidence commits follow it (see commit list below). `apps/web` untouched —
`git diff 1c0bb347..HEAD --stat -- apps/web` is empty."""
assert old in src
src = src.replace(old, new, 1)
old2 = """8. `222a491a` — s3: S3 evidence (EVIDENCE.md + validate transcript + patch provenance)"""
new2 = """8. `222a491a` — s3: S3 evidence (EVIDENCE.md + validate transcript + patch provenance)
9. `f76669b9` — s3: evidence head correction (evidence-only)
(Any further evidence-only commits after these are part of this lane's record; the
authoritative lane-end tip ships in the lane report.)"""
assert old2 in src
path.write_text(src.replace(old2, new2, 1))
print("evidence wording fixed")
