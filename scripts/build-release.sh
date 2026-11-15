#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Build into a fresh release directory, then atomically point
# dist/ (a symlink that nginx serves) at it.
#
#   bash scripts/build-release.sh
#
# Run from the app directory after dependencies are installed and
# VITE_* variables are set. A failed type-check or build exits
# before the swap, so the live site keeps serving the previous
# release. Vite never empties the directory nginx is serving.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

RELEASE="releases/$(date +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
mkdir -p releases

npx tsc -b
npx vite build --outDir "$RELEASE" --emptyOutDir

# One-time migration: dist/ used to be a real directory
if [ -d dist ] && [ ! -L dist ]; then
  mv dist "releases/legacy-$(date +%s)"
fi

ln -sfn "$RELEASE" dist.next
mv -T dist.next dist   # rename(2) is atomic: no moment without a dist/

# Keep the three newest releases for quick rollback:
#   ln -sfn releases/<older> dist.next && mv -T dist.next dist
ls -1dt releases/*/ | tail -n +4 | xargs -r rm -rf

echo "  Live release: $(readlink dist)"
