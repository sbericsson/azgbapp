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

echo "==> Fetching remote branches…"
cd "$REPO_DIR"
git fetch origin

# Build numbered list of remote branches, main first
mapfile -t BRANCHES < <(git branch -r | grep -v 'HEAD' | sed 's|origin/||' | sed 's/^[[:space:]]*//' | sort | { grep '^main$' || true; grep -v '^main$'; })

if [ ${#BRANCHES[@]} -eq 0 ]; then
  echo "✗ No remote branches found. Aborting."
  exit 1
fi

echo ""
echo "Available branches:"
for i in "${!BRANCHES[@]}"; do
  printf "  %2d) %s\n" "$((i+1))" "${BRANCHES[$i]}"
done
echo ""

while true; do
  read -rp "Select branch to deploy [1]: " INPUT
  INPUT="${INPUT:-1}"
  if [[ "$INPUT" =~ ^[0-9]+$ ]] && [ "$INPUT" -ge 1 ] && [ "$INPUT" -le "${#BRANCHES[@]}" ]; then
    BRANCH="${BRANCHES[$((INPUT-1))]}"
    break
  fi
  echo "  Please enter a number between 1 and ${#BRANCHES[@]}."
done

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
