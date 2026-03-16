#!/bin/bash
# CallAnalyzer Rollback Script
# Reverts to the commit saved before the last deploy

set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_MARKER="$APP_DIR/.deploy-backup-commit"

if [ ! -f "$BACKUP_MARKER" ]; then
  echo "No rollback point found. Run deploy.sh first."
  exit 1
fi

PREV_COMMIT=$(cat "$BACKUP_MARKER")
echo "=== CallAnalyzer Rollback ==="
echo "Rolling back to: $PREV_COMMIT"
echo ""

cd "$APP_DIR"

git checkout "$PREV_COMMIT"
npm install --production=false
npm run build
pm2 restart all

echo ""
echo "=== Rollback complete ==="
sleep 2
pm2 logs callanalyzer --lines 10 --nostream
