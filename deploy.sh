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
git pull origin main

echo "==> Installing dependencies…"
# Use --include=dev so devDependencies (TypeScript, Vite, Tailwind) are available for the build
npm ci --include=dev

echo "==> Building…"
npm run build

echo ""
echo "✓ Deploy complete. nginx is already serving dist/ — no restart needed."
