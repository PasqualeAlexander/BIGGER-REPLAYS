#!/usr/bin/env sh
set -eu
APP_DIR="/opt/biggerreplays/app"
cd "$APP_DIR"

echo "[1/4] git pull"
git pull --ff-only

echo "[2/4] npm install"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm i --omit=dev
fi

echo "[3/4] Reiniciar PM2 apuntando al clon"
if pm2 describe biggerreplays >/dev/null 2>&1; then
  pm2 delete biggerreplays || true
fi
pm2 start index.js --name biggerreplays --cwd "$APP_DIR"

pm2 save

echo "[4/4] Hecho. Estado:"
pm2 status | grep biggerreplays || true
