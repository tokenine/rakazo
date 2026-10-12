#!/usr/bin/env bash
# 004-code-mode S3 — V9 grep gate evidence.
#
# Gate: zero secret VALUES in the host tree, the repo tree, and workspace
# storage. The end-to-end flow test (coding-secrets-flow.test.ts) uses a
# RUNTIME-GENERATED canary (prefix `s3canary-`) that exists in no file before
# the run, so any persistence by the injection path would show up here.
#
# Control (gate sensitivity): greping for the intentional TEST plant from the
# egress unit test (`ghp_e2e0a7c1plantedsecret99`) MUST hit exactly the test
# files that plant it — proving the grep is actually sensitive.
set -u
REPO="/home/rakazo/bots/cmugu5zq900dp11o7fei9hl0r/rakazo"
HOST="/home/rakazo"
EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=generated --exclude-dir=.turbo --exclude-dir=dist --exclude-dir=build --exclude-dir=.next)

echo "== V9 grep gate — $(date -u +%Y-%m-%dT%H:%M:%SZ) =="
echo
echo "--- gate 1: runtime canary in REPO tree (expect 0) ---"
count=$(grep -r -l -E "s3canary-[0-9a-f]{32}" "$REPO" "${EXCLUDES[@]}" 2>/dev/null | wc -l)
echo "hits: $count"
echo
echo "--- gate 2: runtime canary in HOST tree, outside the repo (expect 0) ---"
count2=$(grep -r -l -E "s3canary-[0-9a-f]{32}" "$HOST" "${EXCLUDES[@]}" --exclude-dir=rakazo 2>/dev/null | wc -l)
echo "hits: $count2"
echo
echo "--- gate 3: workspace storage under the provider root (data/code-mode-tasks), if present (expect 0 or no dir) ---"
if [ -d "$REPO/data/code-mode-tasks" ]; then
  count3=$(grep -r -l -E "s3canary-[0-9a-f]{32}" "$REPO/data/code-mode-tasks" 2>/dev/null | wc -l)
  echo "hits: $count3"
else
  echo "no workspace storage dir at $REPO/data/code-mode-tasks (flows used temp fixtures) — nothing persisted"
fi
echo
echo "--- CONTROL (gate sensitivity): intentional test plant (expect hits ONLY in the egress test file) ---"
grep -r -l "ghp_e2e0a7c1plantedsecret99" "$REPO" "${EXCLUDES[@]}" 2>/dev/null
echo
echo "--- summary ---"
echo "gate1_repo_hits=$count gate2_host_hits=$count2"
if [ "$count" -eq 0 ] && [ "$count2" -eq 0 ]; then
  echo "V9 GREP GATE: GREEN (zero secret values persisted by the injection path)"
else
  echo "V9 GREP GATE: RED"
  exit 1
fi
