"""One-shot S3 patch (T20): keep 'blanket refusal stands' on one line."""
from pathlib import Path

path = Path("docs/bot-secrets.md")
src = path.read_text()
old = """The **blanket refusal
> stands everywhere else**"""
new = """The **blanket refusal stands
> everywhere else**"""
assert old in src
path.write_text(src.replace(old, new, 1))
print("annotation line fixed")
