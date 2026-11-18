#!/usr/bin/env bash
# Cập nhật bản mới: chép code mới vào /opt/golden-duck/app rồi build lại. Chạy từ thư mục code mới: sudo bash server/deploy/update.sh
set -euo pipefail
APP=/opt/golden-duck
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
/usr/local/bin/golden-duck-backup || true
if [ "$REPO" != "$APP/app" ]; then rsync -a --delete --exclude node_modules --exclude dist-server "$REPO/" "$APP/app/"; fi
chown -R golden-duck:golden-duck "$APP/app"
sudo -u golden-duck bash -c "cd $APP/app && npm ci --no-audit --no-fund && npm run build:server && cd server && npm ci --omit=dev --no-audit --no-fund"
cp "$APP/app/server/deploy/golden-duck.service" /etc/systemd/system/golden-duck.service
systemctl daemon-reload
systemctl restart golden-duck
sleep 3
curl -fsS http://127.0.0.1:8080/api/health && echo
