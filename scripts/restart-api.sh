#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Build the API server bundle and restart it.
#   bash scripts/restart-api.sh azgb-api        (production)
#   bash scripts/restart-api.sh azgb-api-dev    (dev site)
# Uses the PM2 process of that name (how this VPS runs Node apps), else a
# systemd unit of that name. Skips the restart, with a note, if neither exists.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
NAME="${1:-azgb-api}"

npm run build:server

if command -v pm2 >/dev/null && pm2 describe "$NAME" >/dev/null 2>&1; then
  pm2 restart "$NAME" --update-env >/dev/null
  sleep 2
  if pm2 jlist | node -e 'const n=process.argv[1];let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name===n);process.exit(p&&p.pm2_env.status==="online"?0:1)})' "$NAME"; then
    echo "  $NAME restarted (pm2)"
  else
    echo "✗ $NAME is not online: pm2 logs $NAME --lines 50"; exit 1
  fi
elif systemctl cat "$NAME" >/dev/null 2>&1; then
  sudo systemctl restart "$NAME"
  sleep 1
  systemctl is-active --quiet "$NAME" && echo "  $NAME restarted (systemd)" || {
    echo "✗ $NAME failed to start: journalctl -u $NAME -n 50"; exit 1; }
else
  echo "  Note: no pm2 process or systemd unit named $NAME yet; see DEPLOY-SELF-HOSTED.md"
fi
