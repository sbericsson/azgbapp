#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AZGB dev deploy script
# Run this on the SERVER (not locally):
#   bash /var/www/azgb/deploy-dev.sh
#
# Builds a chosen branch with dev Firebase credentials.
# Works entirely in /var/www/azgb-dev — never touches the
# production repo or dist at /var/www/azgb.
# Served at https://dev.golfbender.app
# ─────────────────────────────────────────────────────────────
set -euo pipefail

PROD_DIR="/var/www/azgb"
DEV_DIR="/var/www/azgb-dev"
DEV_ENV="$DEV_DIR/.env"

# ── Bootstrap: make /var/www/azgb-dev its own git repo ───────
if [ ! -d "$DEV_DIR/.git" ]; then
  echo "==> First-time setup: initializing dev repo at $DEV_DIR…"
  REMOTE_URL=$(git -C "$PROD_DIR" remote get-url origin)

  # Preserve existing .env before we touch anything
  ENV_BACKUP=""
  if [ -f "$DEV_ENV" ]; then
    ENV_BACKUP=$(cat "$DEV_ENV")
  fi

  cd "$DEV_DIR"
  git init
  git remote add origin "$REMOTE_URL"

  # Restore .env (git init doesn't touch it, but be explicit)
  if [ -n "$ENV_BACKUP" ]; then
    echo "$ENV_BACKUP" > "$DEV_ENV"
  fi

  echo "  Remote set to: $REMOTE_URL"
fi

# ── Fetch and pick a branch ───────────────────────────────────
echo "==> Fetching remote branches…"
cd "$DEV_DIR"
git fetch origin

# List all branches except main (main belongs to prod only)
mapfile -t BRANCHES < <(git branch -r | grep -v 'HEAD' | grep -v 'origin/main$' | sed 's|origin/||' | sed 's/^[[:space:]]*//' | sort)

if [ ${#BRANCHES[@]} -eq 0 ]; then
  echo "✗ No dev branches found. Push a branch other than main first."
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

# ── Checkout ──────────────────────────────────────────────────
if git rev-parse HEAD >/dev/null 2>&1; then
  PREV_HEAD=$(git rev-parse HEAD)
  git reset --hard "origin/${BRANCH}"
  echo "  Deploying branch: ${BRANCH}"
  echo ""
  git diff --stat "$PREV_HEAD" HEAD || true
else
  # First checkout — no previous HEAD
  git checkout -b "$BRANCH" "origin/$BRANCH"
  echo "  Deploying branch: ${BRANCH} (initial checkout)"
fi
echo ""

# ── Install & build ───────────────────────────────────────────
echo "==> Installing dependencies…"
npm ci --include=dev

echo "==> Building for dev (azgb-dev Firebase project)…"
# Clear any stale VITE_* vars from the shell environment before sourcing the dev env
while IFS='=' read -r key _; do unset "$key"; done < <(printenv | grep '^VITE_')
set -a
# shellcheck source=/dev/null
source "$DEV_ENV"
set +a
npm run build
# dist/ is now at /var/www/azgb-dev/dist — nginx serves it directly

echo ""
echo "✓ Dev deploy complete — https://dev.golfbender.app"
