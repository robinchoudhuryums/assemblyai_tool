#!/bin/bash
# CallAnalyzer Rollback Script
# Reverts to the commit saved before the last deploy.
#
# Usage: ./deploy-rollback.sh [commit-sha]
#   No args    → rolls back to the auto-saved pre-deploy commit
#   commit-sha → rolls back to a specific commit (must exist in git history)

set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_MARKER="$APP_DIR/.deploy-backup-commit"
DEPLOY_LOG="$APP_DIR/.deploy-last.log"

cd "$APP_DIR"

# Determine target commit
if [ -n "$1" ]; then
  TARGET_COMMIT="$1"
  echo "Using explicit rollback target: $TARGET_COMMIT"
else
  if [ ! -f "$BACKUP_MARKER" ]; then
    echo "No rollback point found. Run deploy.sh first, or specify a commit SHA:"
    echo "  ./deploy-rollback.sh <commit-sha>"
    echo ""
    echo "Recent commits:"
    git log --oneline -10
    exit 1
  fi
  TARGET_COMMIT=$(cat "$BACKUP_MARKER")
fi

# Validate the target commit exists
if ! git cat-file -t "$TARGET_COMMIT" >/dev/null 2>&1; then
  echo "Error: Commit '$TARGET_COMMIT' does not exist in git history."
  echo ""
  echo "Recent commits:"
  git log --oneline -10
  exit 1
fi

CURRENT_COMMIT=$(git rev-parse HEAD)
if [ "$CURRENT_COMMIT" = "$TARGET_COMMIT" ]; then
  echo "Already at target commit (${TARGET_COMMIT:0:12}). Nothing to do."
  exit 0
fi

echo "=== CallAnalyzer Rollback ==="
echo "Current:  ${CURRENT_COMMIT:0:12} ($(git log --oneline -1 HEAD))"
echo "Target:   ${TARGET_COMMIT:0:12} ($(git log --oneline -1 "$TARGET_COMMIT"))"
echo ""

# Preserve .env before checkout
[ -f .env ] && cp .env .env.rollback-backup

git checkout "$TARGET_COMMIT"

# Restore .env after checkout
[ -f .env.rollback-backup ] && mv .env.rollback-backup .env

echo "[1/3] Installing dependencies..."
npm install --production=false

echo "[2/3] Building..."
export NODE_OPTIONS="--max-old-space-size=1024"
if ! npm run build; then
  echo "!!! Rollback build failed! Manual intervention required. !!!"
  exit 1
fi

echo "[3/3] Restarting pm2..."
pm2 restart all

# F-26: Post-rollback health check (matches deploy.sh pattern)
echo "[4/4] Health check..."
PORT="${PORT:-5000}"
HEALTH_OK=false
for i in $(seq 1 30); do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/health" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    HEALTH_OK=true
    break
  fi
  sleep 1
done

if [ "$HEALTH_OK" = false ]; then
  echo "!!! WARNING: Health check failed after rollback. Check pm2 logs. !!!"
fi

# Log this rollback
echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') | ROLLBACK | ${CURRENT_COMMIT:0:12} -> ${TARGET_COMMIT:0:12}" >> "$DEPLOY_LOG"

echo ""
echo "=== Rollback complete ==="
echo "Rolled back: ${CURRENT_COMMIT:0:12} → ${TARGET_COMMIT:0:12}"
sleep 2
pm2 logs callanalyzer --lines 10 --nostream 2>/dev/null || true
