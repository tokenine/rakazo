#!/usr/bin/env bash
# Cloudflare container startup: start the control agent first (so the bridge
# can always reach /ping and /debug), mount the bot's R2 home, then run the
# desktop as the rakazo user.
set -uo pipefail

MOUNT="${R2_MOUNT_POINT:-/home/rakazo}"
LOG=/var/log/rakazo/startup.log

# /tmp/rakazo must be writable by the desktop user (xvfb/xdotool logs land there).
mkdir -p "$MOUNT" /tmp/.X11-unix /var/log/rakazo
install -d -o 1000 -g 1000 /tmp/rakazo

{
  echo "[cf-startup] boot $(date -u +%FT%TZ)"
  echo "[cf-startup] /dev/fuse: $(ls -l /dev/fuse 2>&1 | head -1)"
  echo "[cf-startup] env: bucket=${R2_BUCKET:-unset} prefix=${R2_PREFIX:-unset} account=${R2_ACCOUNT_ID:-unset} creds=$([ -n "${R2_ACCESS_KEY_ID:-}" ] && echo yes || echo no)"
} >>"$LOG"

# Agent first: the bridge gates every proxy through /ping, and /debug exposes
# these logs, so a desktop crash can never black-box the container again.
gosu rakazo:rakazo node /usr/local/lib/rakazo/agent.js >>/var/log/rakazo/agent.log 2>&1 &

if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  (
    # Credentials MUST be passed via --shared-config: the image sets HOME=/home/rakazo,
    # so the AWS default path ($HOME/.aws) and the env chain both misresolve here.
    CRED_FILE=/var/rakazo/r2-credentials
    printf '[default]\naws_access_key_id = %s\naws_secret_access_key = %s\n' \
      "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" > "$CRED_FILE"
    chmod 600 "$CRED_FILE"
    echo "[cf-mount] starting tigrisfs ${R2_BUCKET}:${R2_PREFIX} at $MOUNT" >>"$LOG"
    # -f is required: background (daemonizing) mode fork+setsids, which the
    # container sandbox rejects (EPERM) and kills the mount after startup.
    tigrisfs -f \
      --endpoint "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
      --region auto --no-dir-object --uid 1000 --gid 1000 \
      --shared-config "$CRED_FILE" \
      --log-file /var/log/rakazo/tigrisfs.log --log-level info \
      "${R2_BUCKET}:${R2_PREFIX}" "$MOUNT" >>/var/log/rakazo/tigrisfs.log 2>&1
    echo "[cf-mount] tigrisfs exited rc=$?" >>"$LOG"
  ) &
  for _ in $(seq 1 60); do
    grep -qs " $MOUNT fuse" /proc/mounts && break
    sleep 0.5
  done
  grep -qs " $MOUNT fuse" /proc/mounts \
    && echo "[cf-startup] R2 home mounted at $MOUNT" >>"$LOG" \
    || echo "[cf-startup] WARNING: R2 home NOT mounted at $MOUNT" >>"$LOG"
else
  echo "[cf-startup] no R2 credentials — continuing on ephemeral disk" >>"$LOG"
fi

# PID 1 duties: forward TERM to the desktop so its own shutdown trap runs.
gosu rakazo:rakazo /usr/local/bin/rakazo-computer >>"$LOG" 2>&1 &
DESKTOP=$!
trap 'kill -TERM "$DESKTOP" 2>/dev/null' TERM INT
wait "$DESKTOP"
echo "[cf-startup] desktop exited rc=$?" >>"$LOG"
