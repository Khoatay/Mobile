#!/usr/bin/env bash
# Đăng nhập tài khoản Telegram đọc kênh (một lần). Chạy: sudo bash tg-login.sh
set -euo pipefail
sudo -u golden-duck bash -c 'set -a; . /opt/golden-duck/.env; set +a; cd /opt/golden-duck/app/server && npm run tg-login'
systemctl restart golden-duck
sleep 3
curl -fsS http://127.0.0.1:8080/api/health && echo
