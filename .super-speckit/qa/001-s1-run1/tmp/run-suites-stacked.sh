#!/bin/bash
# Stacked retest (F-2/F-3) per-suite runner — mirrors harness.ts integration
# semantics: each suite gets an isolated database cloned from the migrated
# template. QA-only; never part of product code.
set -u
QA=/Users/poom-work/rakazo/.super-speckit/qa/001-s1-run1
WT=/Users/poom-work/.super-speckit-worktrees/ss/bug/001-f3
cd "$WT"
export WAKEUP_DRIVER=memory SANDBOX_PROVIDER=fake AGENT_RUNTIME=scripted CLOUD_AGENT_PROVIDER=emulator
export COMPOSIO_API_KEY= BETTER_AUTH_SECRET="test-secret-test-secret-32chars!"
export ENCRYPTION_KEY="test-encryption-key-test-encryption-key"
export SANDBOX_SUPERVISOR_TOKEN="test-supervisor-token-test-32chars"
export SCREEN_PROXY_SECRET="test-screen-proxy-secret-test-32chars"
export BETTER_AUTH_URL="http://127.0.0.1:5180" WEB_ORIGIN="http://127.0.0.1:5180"
export API_PORT=3110 API_URL="http://127.0.0.1:3110" API_PROXY_TARGET="http://127.0.0.1:3110"
export WEB_PORT=5180 PLAYWRIGHT_BASE_URL="http://127.0.0.1:5180"
export DATA_DIR="$QA/tmp/retest3-data" SIGNUPS_ENABLED=true SIGNUP_ALLOWLIST= CI=1
export OPENROUTER_API_KEY= MODEL_API_KEY= VERIFY_DATABASE=1

for suite in "$@"; do
  db="retest3_$(basename "$suite" .test.ts)"
  docker exec pg-retest3 psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);" > /dev/null 2>&1
  docker exec pg-retest3 psql -U postgres -d postgres -c "CREATE DATABASE \"$db\" TEMPLATE postgres;" > /dev/null || { echo "$suite: TEMPLATE CREATE FAILED"; continue; }
  url="postgresql://postgres:check_pw@localhost:54333/$db"
  DATABASE_URL="$url" REALTIME_DATABASE_URL="$url" pnpm exec vitest run "$suite" > "$QA/logs/stacked-$(basename "$suite" .test.ts).log" 2>&1
  status=$?
  summary=$(grep -E "Test Files|Tests " "$QA/logs/stacked-$(basename "$suite" .test.ts).log" | tr '\n' ' ')
  echo "$suite => exit $status | $summary"
  docker exec pg-retest3 psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);" > /dev/null 2>&1
done
