#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AZGB dev deploy script
# Run this on the SERVER (not locally):
#   bash /var/www/azgb/deploy-dev.sh
#
# Or trigger it remotely from your laptop:
#   ssh user@your-server.com "bash /var/www/azgb/deploy-dev.sh"
#
# Builds with dev Firebase credentials → /var/www/azgb-dev/dist/
# Served at https://dev.golfbender.app
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="/var/www/azgb"
DEV_ENV="/var/www/azgb-dev/.env"
DEV_DIST="/var/www/azgb-dev/dist"

echo "==> Pulling latest code…"
cd "$REPO_DIR"
git fetch origin

# Prompt for branch, defaulting to main
DEFAULT_BRANCH="main"
read -rp "Branch to deploy [${DEFAULT_BRANCH}]: " INPUT_BRANCH
BRANCH="${INPUT_BRANCH:-$DEFAULT_BRANCH}"

# Verify the branch exists on origin
if ! git rev-parse --verify "origin/${BRANCH}" &>/dev/null; then
  echo "✗ Branch 'origin/${BRANCH}' not found. Aborting."
  exit 1
fi

PREV_HEAD=$(git rev-parse HEAD)
git reset --hard "origin/${BRANCH}"
echo "  Deploying branch: ${BRANCH}"
echo ""
git diff --stat "$PREV_HEAD" HEAD
echo ""

echo "==> Installing dependencies…"
npm ci --include=dev

echo "==> Building for dev (azgb-dev Firebase project)…"
# Load dev credentials into env, build, then clean up
set -a
# shellcheck source=/dev/null
source "$DEV_ENV"
set +a
npm run build

echo "==> Copying dist to $DEV_DIST…"
rm -rf "$DEV_DIST"
cp -r "$REPO_DIR/dist" "$DEV_DIST"

echo ""
echo "✓ Dev deploy complete — https://dev.golfbender.app"
