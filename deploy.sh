#!/bin/bash
# CallAnalyzer EC2 Deploy Script
# Usage: ./deploy.sh [branch]
# Default branch: main

set -e

BRANCH="${1:-main}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== CallAnalyzer Deploy ==="
echo "Branch: $BRANCH"
echo "Directory: $APP_DIR"
echo ""

cd "$APP_DIR"

# Pull latest code
echo "[1/4] Pulling latest code..."
git pull origin "$BRANCH"

# Install dependencies
echo "[2/4] Installing dependencies..."
npm install --production=false

# Build
echo "[3/4] Building..."
npm run build

# Restart
echo "[4/4] Restarting pm2..."
pm2 restart all

echo ""
echo "=== Deploy complete ==="
echo ""

# Show logs to verify startup
sleep 2
pm2 logs callanalyzer --lines 10 --nostream
