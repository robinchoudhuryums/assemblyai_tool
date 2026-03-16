#!/bin/bash
# CallAnalyzer EC2 Deploy Script
# Usage: ./deploy.sh [branch]
# Default branch: main

set -e

BRANCH="${1:-main}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_MARKER="$APP_DIR/.deploy-backup-commit"

echo "=== CallAnalyzer Deploy ==="
echo "Branch: $BRANCH"
echo "Directory: $APP_DIR"
echo ""

cd "$APP_DIR"

# Save current commit for rollback
PREV_COMMIT=$(git rev-parse HEAD)
echo "$PREV_COMMIT" > "$BACKUP_MARKER"
echo "Saved rollback point: $PREV_COMMIT"

# Pull latest code
echo "[1/4] Pulling latest code..."
git pull origin "$BRANCH"

# Install dependencies
echo "[2/4] Installing dependencies..."
npm install --production=false

# Build (with rollback on failure)
echo "[3/4] Building..."
if ! npm run build; then
  echo ""
  echo "!!! BUILD FAILED — Rolling back to $PREV_COMMIT !!!"
  git checkout "$PREV_COMMIT"
  npm install --production=false
  npm run build
  pm2 restart all
  echo "Rollback complete. Fix the build errors and try again."
  exit 1
fi

# Restart
echo "[4/4] Restarting pm2..."
pm2 restart all

echo ""
echo "=== Deploy complete ==="
echo "To rollback: ./deploy-rollback.sh"
echo ""

# Show logs to verify startup
sleep 2
pm2 logs callanalyzer --lines 10 --nostream
