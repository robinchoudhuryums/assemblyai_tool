#!/bin/bash
# CallAnalyzer — Deployment / Update Script
# Run this on the EC2 instance to pull latest code and redeploy.
#
# Usage:
#   ssh ec2-user@YOUR_IP "sudo /opt/callanalyzer/deploy/ec2/deploy.sh"
#   OR from the instance:
#   sudo /opt/callanalyzer/deploy/ec2/deploy.sh

set -euo pipefail

APP_DIR="/opt/callanalyzer"
APP_USER="callanalyzer"
BRANCH="${1:-main}"

echo "=== CallAnalyzer Deploy — $(date) ==="
echo "Branch: $BRANCH"

cd "$APP_DIR"

# Pull latest code
echo "--- Pulling latest code ---"
sudo -u "$APP_USER" git fetch origin "$BRANCH"
sudo -u "$APP_USER" git checkout "$BRANCH"
sudo -u "$APP_USER" git pull origin "$BRANCH"

# Install dependencies
echo "--- Installing dependencies ---"
sudo -u "$APP_USER" npm ci --production=false

# Build
echo "--- Building ---"
sudo -u "$APP_USER" npm run build

# Prune dev dependencies
echo "--- Pruning dev dependencies ---"
sudo -u "$APP_USER" npm prune --production

# Restart the service
echo "--- Restarting CallAnalyzer ---"
systemctl restart callanalyzer

# Wait and check status
sleep 3
if systemctl is-active --quiet callanalyzer; then
    echo "--- CallAnalyzer is running ---"
    systemctl status callanalyzer --no-pager
else
    echo "!!! CallAnalyzer failed to start !!!"
    journalctl -u callanalyzer --no-pager -n 30
    exit 1
fi

echo ""
echo "=== Deploy complete — $(date) ==="
