#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AZGB deploy script
# Run this on the SERVER (not locally):
#   bash /var/www/azgb/deploy.sh
#
# Or trigger it remotely from your laptop:
#   ssh user@your-server.com "bash /var/www/azgb/deploy.sh"
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="/var/www/azgb"

echo "==> Pulling latest code…"
cd "$REPO_DIR"
git fetch origin
PREV_HEAD=$(git rev-parse HEAD)
git reset --hard origin/main
echo ""
git diff --stat "$PREV_HEAD" HEAD
echo ""

echo "==> Installing dependencies…"
# Use --include=dev so devDependencies (TypeScript, Vite, Tailwind) are available for the build
npm ci --include=dev

echo "==> Building…"
# Clear any VITE_* vars exported into the shell environment — they override .env files
while IFS='=' read -r key _; do unset "$key"; done < <(printenv | grep '^VITE_')
npm run build

echo ""
echo "✓ Deploy complete. nginx is already serving dist/ — no restart needed."
