#!/usr/bin/env bash
# Cài Golden Duck lên VPS (Ubuntu 22.04/24.04, x86 hoặc ARM). Chạy: sudo bash install.sh ten-mien-cua-ban.com
# Chạy lại nhiều lần không sao: bước nào đã xong thì bỏ qua.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Cách dùng: sudo bash install.sh ten-mien-cua-ban.com"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Cần chạy bằng sudo"; exit 1; }
APP=/opt/golden-duck
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

echo "== 1/7 Gói hệ thống"
apt-get update -y
apt-get install -y curl git rsync sqlite3 debian-keyring debian-archive-keyring apt-transport-https gnupg iptables-persistent

echo "== 2/7 Node 22"
if ! node -v 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== 3/7 Caddy (HTTPS tự động)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== 4/7 Mở cổng 80, 443 trong tường lửa của máy (nếu có)"
for p in 443 80; do
  iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport $p -m state --state NEW -j ACCEPT
done
netfilter-persistent save

echo "== 5/7 Người dùng và thư mục"
id golden-duck >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin golden-duck
mkdir -p "$APP/data" "$APP/backup"
if [ "$REPO" != "$APP/app" ]; then rm -rf "$APP/app"; cp -a "$REPO" "$APP/app"; fi
if [ ! -f "$APP/.env" ]; then
  sed "s#https://ten-mien-cua-ban.vn#https://$DOMAIN#" "$APP/app/server/.env.example" > "$APP/.env"
  echo "   Đã tạo $APP/.env — điền khoá sau khi cài xong."
fi
chmod 600 "$APP/.env"
chown -R golden-duck:golden-duck "$APP"

echo "== 6/7 Cài thư viện và build web app (vài phút)"
sudo -u golden-duck bash -c "cd $APP/app && npm ci --no-audit --no-fund && npm run build:server && cd server && npm ci --omit=dev --no-audit --no-fund"

echo "== 7/7 Dịch vụ chạy nền, HTTPS, sao lưu"
cp "$HERE/golden-duck.service" /etc/systemd/system/golden-duck.service
sed "s#ten-mien-cua-ban.vn#$DOMAIN#" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
install -m 755 "$HERE/backup.sh" /usr/local/bin/golden-duck-backup
echo "17 3 * * * root /usr/local/bin/golden-duck-backup" > /etc/cron.d/golden-duck-backup
systemctl daemon-reload
systemctl enable --now golden-duck
systemctl restart caddy
sleep 3
curl -fsS http://127.0.0.1:8080/api/health && echo
echo
echo "Xong. Mở https://$DOMAIN (lần đầu Caddy cần ~1 phút để lấy chứng chỉ)."
echo "Tiếp theo: điền khoá trong $APP/.env (sudo nano $APP/.env), rồi: sudo systemctl restart golden-duck"
echo "Đăng nhập tài khoản đọc kênh: sudo bash $APP/app/server/deploy/tg-login.sh"
