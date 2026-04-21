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

# Cap Node heap to fit alongside the running pm2 process (~217MB) on a 1GB
# t3.nano. Tests no longer run here (see rationale in step [3/5] below), so
# 768MB leaves ~440MB headroom for tsc + the esbuild bundler, both of which
# peak well under that. The build step's package.json command sets a higher
# 1536MB limit which overrides this export for that one invocation.
export NODE_OPTIONS="--max-old-space-size=768"

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
if ! git fetch origin "$BRANCH"; then
  echo "::error::Git fetch failed. Check network or branch name."
  exit 1
fi
# Discard any on-box drift to tracked files (e.g. package-lock.json from a
# stray `npm install` run on the EC2 box) so it can't block the merge. .env
# and other gitignored files are not affected.
if ! git reset --hard "origin/$BRANCH"; then
  echo "::error::Git reset to origin/$BRANCH failed."
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

# [3/5] Type check (cheap) — unit tests run in CI before deploy triggers, not here.
#
# Why no `npm run test` here:
# The production EC2 instance is a 1GB-RAM t3.nano. The test suite grew to
# 966 tests, which at NODE_OPTIONS=--max-old-space-size=1024 plus pm2 holding
# ~217MB for the running app consistently OOMs on this box (seen in deploy
# #142, 2026-04-21). GitHub Actions CI already runs the full suite as a merge
# gate before the deploy workflow triggers via workflow_run on CI success —
# re-running them on the constrained EC2 host is redundant AND unstable. tsc
# stays because it's cheap and catches build-breaking syntax/type errors that
# could slip past CI via dependency updates.
#
# If you need to re-run tests on EC2 for a specific debugging reason, set
# DEPLOY_RUN_TESTS=true before invoking this script. Default: skipped.
echo "[3/5] Running type check..."
if ! npm run check; then
  rollback "TypeScript type check failed"
fi

if [ "${DEPLOY_RUN_TESTS:-false}" = "true" ]; then
  echo "  DEPLOY_RUN_TESTS=true — running unit tests (may OOM on <2GB RAM hosts)"
  if ! npm run test; then
    rollback "Unit tests failed"
  fi
fi

# [4/5] Build
echo "[4/5] Building..."
if ! npm run build; then
  rollback "Production build failed"
fi

# [5/5] Zero-downtime reload
echo "[5/5] Reloading app (zero-downtime)..."
# Always launch via the ecosystem file so env vars (NODE_EXTRA_CA_CERTS for
# the RDS CA bundle, NODE_ENV, etc.) are the source of truth. pm2 startOrReload
# does reload-in-place if the process exists, or start-fresh otherwise — and
# --update-env picks up any changes to the ecosystem env block without needing
# a delete+start cycle.
ECOSYSTEM_FILE="$APP_DIR/ecosystem.config.cjs"
if [ -f "$ECOSYSTEM_FILE" ]; then
  if pm2 startOrReload "$ECOSYSTEM_FILE" --only callanalyzer --update-env; then
    echo "Reloaded callanalyzer from ecosystem file (zero-downtime)"
  else
    rollback "pm2 startOrReload from ecosystem file failed"
  fi
else
  # Fallback for old checkouts that don't have the ecosystem file.
  # WARNING: this path loses NODE_EXTRA_CA_CERTS — RDS TLS will fail.
  echo "WARNING: $ECOSYSTEM_FILE not found, falling back to ad-hoc start"
  if pm2 reload callanalyzer 2>/dev/null; then
    echo "Reloaded callanalyzer (zero-downtime)"
  elif pm2 restart all 2>/dev/null; then
    echo "Restarted all pm2 processes"
  else
    echo "No existing pm2 processes — starting fresh..."
    pm2 start dist/index.js --name callanalyzer
  fi
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

# Admin-lockout guard — detect the F-06 bootstrap gotcha. On a fresh deploy
# where REQUIRE_MFA=true is set but no DB admin exists yet, AUTH_USERS-based
# admins get blocked at login (they can't enroll MFA, no DB row for the TOTP
# secret). Catch this post-migration + post-health so the operator sees it
# BEFORE walking away from the terminal. See CLAUDE.md § Operator State
# Checklist for the full recovery flow.
#
# Only runs when:
#   (a) psql is installed (shell-out check; bundled with postgresql-client on
#       the default EC2 AMIs but not guaranteed);
#   (b) DATABASE_URL is reachable via .env; and
#   (c) REQUIRE_MFA=true is set in .env.
# Any of (a)–(c) missing → skip silently, this check is opt-in-by-env.
if command -v psql > /dev/null 2>&1 && [ -f .env ]; then
  ENV_REQUIRE_MFA=$(grep -E '^REQUIRE_MFA=' .env 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]')
  ENV_DATABASE_URL=$(grep -E '^DATABASE_URL=' .env 2>/dev/null | head -1 | cut -d'=' -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  if [ "$ENV_REQUIRE_MFA" = "true" ] && [ -n "$ENV_DATABASE_URL" ]; then
    # `|| echo ""` so a query error (e.g. users table not yet migrated) is
    # treated as "unknown" rather than aborting the deploy script.
    ADMIN_COUNT=$(psql "$ENV_DATABASE_URL" -At -c "SELECT COUNT(*) FROM users WHERE role='admin' AND active=TRUE" 2>/dev/null || echo "")
    if [ "$ADMIN_COUNT" = "0" ]; then
      echo ""
      echo "!!! WARNING — LOCKOUT RISK DETECTED !!!"
      echo ""
      echo "  REQUIRE_MFA=true is set in .env, but the \`users\` table has zero"
      echo "  active admin rows. AUTH_USERS-based admins CANNOT enroll in MFA"
      echo "  (no DB row to store the TOTP secret) and will be BLOCKED AT LOGIN."
      echo ""
      echo "  Recovery: run this on the EC2 box BEFORE logging in:"
      echo ""
      echo "    npm run seed-admin -- \\"
      echo "      --username=<email> \\"
      echo "      --password='<strong-password>' \\"
      echo "      --name='<Display Name>'"
      echo ""
      echo "  Password must meet HIPAA complexity: 12+ chars, upper, lower,"
      echo "  digit, special. Single-quote it so the shell doesn't interpret"
      echo "  ! \$ or other special chars."
      echo ""
    fi
  fi
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
