#!/usr/bin/env sh
set -eu
RELEASE="$1"
BASE=/opt/biggerreplays
RELDIR="$BASE/releases/biggerreplays-$RELEASE"
ARCH="$BASE/releases/biggerreplays-$RELEASE.tar.gz"

mkdir -p "$BASE/releases" "$RELDIR"

# Instalar Node.js si no est??
if ! command -v node >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  fi
fi

# Instalar PM2 si no est??
if ! command -v pm2 >/dev/null 2>&1; then
  npm i -g pm2
fi

# Extraer release e instalar deps
if [ ! -f "$ARCH" ]; then
  echo "No existe el archivo $ARCH" >&2
  exit 1
fi

tar -xzf "$ARCH" -C "$RELDIR"
cd "$RELDIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm i --omit=dev
fi

# Symlink actual y PM2
ln -sfn "$RELDIR" "$BASE/current"
if pm2 describe biggerreplays >/dev/null 2>&1; then
  pm2 restart biggerreplays
else
  pm2 start index.js --name biggerreplays --cwd "$BASE/current"
fi
pm2 save
