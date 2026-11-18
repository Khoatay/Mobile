#!/usr/bin/env bash
# Sao lưu dữ liệu mỗi ngày (cron 3:17 sáng), giữ 14 bản gần nhất. Gồm cơ sở dữ liệu và phiên Telegram.
set -euo pipefail
D=/opt/golden-duck
STAMP=$(date +%Y%m%d)
sqlite3 "$D/data/golden-duck.db" ".backup '$D/backup/golden-duck-$STAMP.db'"
[ -f "$D/data/tg.session" ] && cp "$D/data/tg.session" "$D/backup/tg-$STAMP.session"
chmod 600 "$D"/backup/*
chown golden-duck:golden-duck "$D"/backup/*
ls -1t "$D"/backup/golden-duck-*.db | tail -n +15 | xargs -r rm -f
ls -1t "$D"/backup/tg-*.session 2>/dev/null | tail -n +15 | xargs -r rm -f
