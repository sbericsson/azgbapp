#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Build the API server bundle and restart its systemd unit.
#   bash scripts/restart-api.sh azgb-api        (production)
#   bash scripts/restart-api.sh azgb-api-dev    (dev site)
# Skips the restart, with a note, when the unit is not installed yet.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
UNIT="${1:-azgb-api}"

npm run build:server

if systemctl cat "$UNIT" >/dev/null 2>&1; then
  sudo systemctl restart "$UNIT"
  sleep 1
  systemctl is-active --quiet "$UNIT" && echo "  $UNIT restarted" || {
    echo "✗ $UNIT failed to start: journalctl -u $UNIT -n 50"; exit 1; }
else
  echo "  Note: systemd unit $UNIT is not installed yet; see DEPLOY-SELF-HOSTED.md"
fi
