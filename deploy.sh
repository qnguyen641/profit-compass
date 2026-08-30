#!/usr/bin/env bash
# Deploy Profit Compass to a server over SSH.
# Usage: ./deploy.sh user@server [port]   (default app port 8018)
set -euo pipefail

TARGET="${1:?usage: ./deploy.sh user@server [app_port]}"
PORT="${2:-8018}"
DIR="/opt/profit-compass"

echo "==> copying project to $TARGET:$DIR"
tar czf /tmp/profit-compass.tar.gz --exclude='backend/data/app.db' --exclude='.env' \
    -C "$(dirname "$0")" \
    backend frontend Dockerfile docker-compose.yml .env.example README.md
ssh "$TARGET" "mkdir -p $DIR"
scp /tmp/profit-compass.tar.gz "$TARGET:$DIR/"
ssh "$TARGET" "cd $DIR && tar xzf profit-compass.tar.gz && rm profit-compass.tar.gz && \
  ([ -f .env ] || cp .env.example .env) && \
  PC_PORT=$PORT docker compose up -d --build"

echo "==> done. If this is the first deploy, edit $DIR/.env on the server"
echo "    (set ANTHROPIC_API_KEY) and run: cd $DIR && docker compose up -d"
echo "==> app: http://<server-ip>:$PORT"
