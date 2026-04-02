#!/bin/bash
# CallAnalyzer — Blue-Green Deploy Script
# Usage: ./deploy-bluegreen.sh [branch]
# Default branch: main
#
# How it works:
#   1. Detect which slot is active (blue on :5000, green on :5001)
#   2. Pull latest code + install + type check + test + build
#   3. Start the INACTIVE slot on its port
#   4. Health-check the new slot
#   5. If healthy: swap Caddy upstream to new port → stop old slot
#   6. If unhealthy: kill new slot → old slot stays live → zero user impact
#
# Prerequisites:
#   - Caddy running with admin API enabled (admin localhost:2019)
#   - pm2 installed globally
#   - ecosystem.config.cjs in project root
#
# Rollback: just run the script again — it will swap back to the other slot.

set -e

BRANCH="${1:-main}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_LOG="$APP_DIR/.deploy-last.log"

BLUE_PORT=5000
GREEN_PORT=5001
BLUE_NAME="callanalyzer-blue"
GREEN_NAME="callanalyzer-green"
CADDY_ADMIN="http://localhost:2019"
HEALTH_TIMEOUT=30

echo "=== CallAnalyzer Blue-Green Deploy ==="
echo "Branch: $BRANCH"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

cd "$APP_DIR"
export NODE_OPTIONS="--max-old-space-size=1024"

# --- Detect active slot ---
detect_active() {
  if curl -sf "http://localhost:${BLUE_PORT}/api/health" > /dev/null 2>&1; then
    echo "blue"
  elif curl -sf "http://localhost:${GREEN_PORT}/api/health" > /dev/null 2>&1; then
    echo "green"
  else
    echo "none"
  fi
}

ACTIVE=$(detect_active)
echo "Current active slot: ${ACTIVE:-none}"

if [ "$ACTIVE" = "blue" ]; then
  NEW_NAME="$GREEN_NAME"
  NEW_PORT="$GREEN_PORT"
  OLD_NAME="$BLUE_NAME"
  OLD_PORT="$BLUE_PORT"
elif [ "$ACTIVE" = "green" ]; then
  NEW_NAME="$BLUE_NAME"
  NEW_PORT="$BLUE_PORT"
  OLD_NAME="$GREEN_NAME"
  OLD_PORT="$GREEN_PORT"
else
  # No active slot — start blue
  NEW_NAME="$BLUE_NAME"
  NEW_PORT="$BLUE_PORT"
  OLD_NAME=""
  OLD_PORT=""
fi

echo "Deploying to: ${NEW_NAME} (port ${NEW_PORT})"

# [1/5] Pull latest code
echo ""
echo "[1/5] Pulling latest code..."
PREV_COMMIT=$(git rev-parse HEAD)
if ! git pull origin "$BRANCH"; then
  echo "::error::Git pull failed."
  exit 1
fi
NEW_COMMIT=$(git rev-parse HEAD)

# [2/5] Install dependencies
echo "[2/5] Installing dependencies..."
if ! npm install --production=false; then
  echo "!!! npm install failed — old slot still serving traffic"
  exit 1
fi

# [3/5] Type check + tests
echo "[3/5] Running type check and tests..."
if ! npm run check; then
  echo "!!! Type check failed — old slot still serving traffic"
  exit 1
fi
if ! npm run test; then
  echo "!!! Tests failed — old slot still serving traffic"
  exit 1
fi

# [4/5] Build
echo "[4/5] Building..."
if ! npm run build; then
  echo "!!! Build failed — old slot still serving traffic"
  exit 1
fi

# [5/5] Start new slot, health check, swap
echo "[5/5] Starting ${NEW_NAME}..."

# Stop new slot if it was running from a previous deploy
pm2 delete "$NEW_NAME" 2>/dev/null || true

# Start new slot
pm2 start ecosystem.config.cjs --only "$NEW_NAME"

# Health check new slot
echo "Waiting for ${NEW_NAME} to pass health check..."
HEALTHY=false
TRIES=0
while [ "$TRIES" -lt "$HEALTH_TIMEOUT" ]; do
  TRIES=$((TRIES + 1))
  if curl -sf "http://localhost:${NEW_PORT}/api/health" > /dev/null 2>&1; then
    echo "${NEW_NAME} healthy after ${TRIES}s"
    HEALTHY=true
    break
  fi
  sleep 1
done

if [ "$HEALTHY" != "true" ]; then
  echo ""
  echo "!!! ${NEW_NAME} failed health check — rolling back"
  echo "Recent logs:"
  pm2 logs "$NEW_NAME" --lines 20 --nostream 2>/dev/null || true
  pm2 delete "$NEW_NAME" 2>/dev/null || true
  echo "Old slot (${OLD_NAME:-none}) still serving traffic."
  exit 1
fi

# --- Swap traffic ---
# Try Caddy admin API first (hot swap, no restart needed)
CADDY_SWAPPED=false
if curl -sf "${CADDY_ADMIN}/config/" > /dev/null 2>&1; then
  echo "Swapping Caddy upstream to port ${NEW_PORT}..."
  # Caddy's admin API accepts JSON patches
  # This updates the reverse_proxy upstream dial address
  if curl -sf -X PATCH "${CADDY_ADMIN}/config/apps/http/servers/srv0/routes/0/handle/0/upstreams/0/dial" \
    -H "Content-Type: application/json" \
    -d "\"localhost:${NEW_PORT}\"" 2>/dev/null; then
    CADDY_SWAPPED=true
    echo "Caddy upstream swapped to port ${NEW_PORT}"
  fi
fi

if [ "$CADDY_SWAPPED" != "true" ]; then
  echo "Caddy admin API not available — using pm2 port swap instead."
  echo "NOTE: For true zero-downtime, enable Caddy admin API (admin localhost:2019 in Caddyfile)"
  # Fallback: stop old, and the new slot is already on its port.
  # If using a simple Caddyfile with "reverse_proxy localhost:5000",
  # we need the new slot on port 5000. Since we built it on a different port,
  # restart it on the expected port.
  if [ "$NEW_PORT" != "$BLUE_PORT" ]; then
    echo "Restarting ${NEW_NAME} on port ${BLUE_PORT}..."
    pm2 delete "$NEW_NAME" 2>/dev/null || true
    PORT=$BLUE_PORT pm2 start dist/index.js --name "$NEW_NAME"
    # Re-verify health on swapped port
    TRIES=0
    while [ "$TRIES" -lt 15 ]; do
      TRIES=$((TRIES + 1))
      if curl -sf "http://localhost:${BLUE_PORT}/api/health" > /dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  fi
fi

# Stop old slot
if [ -n "$OLD_NAME" ]; then
  echo "Stopping old slot: ${OLD_NAME}"
  pm2 delete "$OLD_NAME" 2>/dev/null || true
fi

pm2 save 2>/dev/null || true

echo ""
echo "=== Blue-Green Deploy Complete ==="
echo "Active: ${NEW_NAME} on port ${NEW_PORT}"
echo "Previous: ${PREV_COMMIT:0:12}"
echo "Current:  ${NEW_COMMIT:0:12}"
echo "Rollback: Run this script again to swap back"
echo ""

echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') | $BRANCH | ${PREV_COMMIT:0:12} -> ${NEW_COMMIT:0:12} | ${NEW_NAME}" >> "$DEPLOY_LOG"

pm2 logs "$NEW_NAME" --lines 10 --nostream 2>/dev/null || true
