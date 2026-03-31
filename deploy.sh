#!/bin/bash
# CallAnalyzer EC2 Deploy Script
# Usage: ./deploy.sh [branch]
# Default branch: main
#
# Steps:
#   1. Save rollback point
#   2. Pull latest code
#   3. Install dependencies
#   4. Run type check + unit tests (fail-fast)
#   5. Build production bundle
#   6. Restart pm2
#
# On build/test failure: automatic rollback to previous commit.

set -e

BRANCH="${1:-main}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_MARKER="$APP_DIR/.deploy-backup-commit"
DEPLOY_LOG="$APP_DIR/.deploy-last.log"

echo "=== CallAnalyzer Deploy ==="
echo "Branch: $BRANCH"
echo "Directory: $APP_DIR"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

cd "$APP_DIR"

# Prevent OOM on memory-constrained EC2 instances (applies to tsc, tests, and build)
export NODE_OPTIONS="--max-old-space-size=1024"

# Save current commit for rollback
PREV_COMMIT=$(git rev-parse HEAD)
echo "$PREV_COMMIT" > "$BACKUP_MARKER"
echo "Saved rollback point: ${PREV_COMMIT:0:12}"

# --- Helper: rollback on failure ---
rollback() {
  local reason="$1"
  echo ""
  echo "!!! DEPLOY FAILED: $reason !!!"
  echo "Rolling back to ${PREV_COMMIT:0:12}..."

  # Preserve .env before checkout
  [ -f .env ] && cp .env .env.deploy-backup

  git checkout "$PREV_COMMIT" 2>/dev/null
  [ -f .env.deploy-backup ] && mv .env.deploy-backup .env

  npm install --production=false 2>/dev/null
  if npm run build 2>/dev/null; then
    pm2 restart all 2>/dev/null || true
    echo "Rollback complete. Fix the errors and try again."
  else
    echo "!!! ROLLBACK BUILD ALSO FAILED — manual intervention required !!!"
    echo "Server may be in a broken state. Check pm2 logs."
  fi
  exit 1
}

# [1/5] Pull latest code
echo "[1/5] Pulling latest code..."
if ! git pull origin "$BRANCH"; then
  echo "::error::Git pull failed. Check network or branch name."
  exit 1
fi

NEW_COMMIT=$(git rev-parse HEAD)
if [ "$PREV_COMMIT" = "$NEW_COMMIT" ]; then
  echo "Already up to date (${NEW_COMMIT:0:12}). Continuing anyway (dependency/rebuild check)."
fi

# [2/5] Install dependencies
echo "[2/5] Installing dependencies..."
if ! npm install --production=false; then
  rollback "npm install failed"
fi

# [3/5] Type check + unit tests
echo "[3/5] Running type check and tests..."
if ! npm run check; then
  rollback "TypeScript type check failed"
fi

if ! npm run test; then
  rollback "Unit tests failed"
fi

# [4/5] Build
echo "[4/5] Building..."
if ! npm run build; then
  rollback "Production build failed"
fi

# [5/5] Zero-downtime reload
echo "[5/5] Reloading app (zero-downtime)..."
# pm2 reload starts a new process before killing the old one — no gap.
# Falls back to restart if reload not supported, or start if no process exists.
if pm2 reload callanalyzer 2>/dev/null; then
  echo "Reloaded callanalyzer (zero-downtime)"
elif pm2 restart all 2>/dev/null; then
  echo "Restarted all pm2 processes"
else
  echo "No existing pm2 processes — starting fresh..."
  pm2 start dist/index.js --name callanalyzer
fi
pm2 save 2>/dev/null || true

# Post-deploy health gate — verify app is responding before declaring success.
# If health check fails, auto-rollback to the previous commit.
echo "Verifying deploy health..."
APP_PORT="${PORT:-5000}"
HEALTHY=false
TRIES=0
while [ "$TRIES" -lt 30 ]; do
  TRIES=$((TRIES + 1))
  if curl -sf "http://localhost:${APP_PORT}/api/health" > /dev/null 2>&1; then
    echo "App healthy after ${TRIES}s"
    HEALTHY=true
    break
  fi
  sleep 1
done

if [ "$HEALTHY" != "true" ]; then
  echo ""
  echo "!!! HEALTH CHECK FAILED after 30s — rolling back !!!"
  echo "Recent logs:"
  pm2 logs callanalyzer --lines 20 --nostream 2>/dev/null || true
  rollback "App failed to respond to /api/health within 30 seconds"
fi

echo ""
echo "=== Deploy complete ==="
echo "Previous: ${PREV_COMMIT:0:12}"
echo "Current:  ${NEW_COMMIT:0:12}"
echo "To rollback: ./deploy-rollback.sh"
echo ""

# Log this deploy
echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') | $BRANCH | ${PREV_COMMIT:0:12} -> ${NEW_COMMIT:0:12}" >> "$DEPLOY_LOG"

# Show recent logs to verify startup
pm2 logs callanalyzer --lines 10 --nostream || true
