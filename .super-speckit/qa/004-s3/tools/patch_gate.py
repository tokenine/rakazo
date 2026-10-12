"""One-shot S3 patch: grep gate matches the RUNTIME canary shape (32 hex), not the prefix literal."""
from pathlib import Path

path = Path(".super-speckit/qa/004-s3/tools/v9-grep-gate.sh")
src = path.read_text()
src = src.replace(
    'grep -r -l "s3canary-" "$REPO" "${EXCLUDES[@]}" 2>/dev/null | wc -l',
    'grep -r -l -E "s3canary-[0-9a-f]{32}" "$REPO" "${EXCLUDES[@]}" 2>/dev/null | wc -l',
)
src = src.replace(
    'grep -r -l "s3canary-" "$HOST" "${EXCLUDES[@]}" --exclude-dir=rakazo 2>/dev/null | wc -l',
    'grep -r -l -E "s3canary-[0-9a-f]{32}" "$HOST" "${EXCLUDES[@]}" --exclude-dir=rakazo 2>/dev/null | wc -l',
)
src = src.replace(
    'grep -r -l "s3canary-" "$REPO/data/code-mode-tasks" 2>/dev/null | wc -l',
    'grep -r -l -E "s3canary-[0-9a-f]{32}" "$REPO/data/code-mode-tasks" 2>/dev/null | wc -l',
)
path.write_text(src)
print("gate regex fixed")
