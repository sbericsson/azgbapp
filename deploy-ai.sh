#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AZGB deploy script — azgb-app-ai branch
# Run this on the SERVER (not locally):
#   bash /var/www/azgb/deploy-ai.sh
#
# Or trigger it remotely from your laptop:
#   ssh user@your-server.com "bash /var/www/azgb/deploy-ai.sh"
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="/var/www/azgb"

echo "==> Pulling latest code (azgb-app-ai)…"
cd "$REPO_DIR"
git fetch origin
git checkout -f azgb-app-ai
git pull origin azgb-app-ai

echo "==> Installing dependencies…"
# Use --include=dev so devDependencies (TypeScript, Vite, Tailwind) are available for the build
npm ci --include=dev

echo "==> Building…"
npm run build

echo ""
echo "✓ Deploy complete. nginx is already serving dist/ — no restart needed."
