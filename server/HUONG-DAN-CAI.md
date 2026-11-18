# Cài Golden Duck lên Oracle Cloud (từng bước)

Làm một lần, khoảng 30–45 phút. Không cần biết lập trình: chỉ chép từng lệnh dán vào cửa sổ dòng lệnh.

## Cần chuẩn bị

| Thứ | Lấy ở đâu |
|---|---|
| Máy Oracle Always Free (Ubuntu, nên chọn máy ARM Ampere 2 nhân, 12 GB RAM) | cloud.oracle.com → Compute → Instances |
| Tên miền của bạn | nơi bạn mua tên miền |
| Khoá AI | console.anthropic.com → API Keys (nạp tiền trước, ví dụ 10 USD) |
| Bot Telegram | Telegram → @BotFather → `/newbot` → đặt tên, ví dụ `GoldenDuckBot` → nhận mã bot |
| Một số điện thoại riêng cho tài khoản đọc kênh | SIM riêng, tạo một tài khoản Telegram mới bằng số này |
| API ID / API Hash của tài khoản đó | my.telegram.org → đăng nhập bằng số riêng → API development tools → tạo app |

Tài khoản đọc kênh nên là số **riêng**, không dùng Telegram cá nhân của bạn: máy chủ sẽ tự vào mọi kênh khách thêm.

## Bước 1: Mở cổng trên Oracle

1. Oracle → Networking → Virtual Cloud Networks → mạng của máy → Security Lists → Default Security List.
2. Add Ingress Rules hai lần: Source CIDR `0.0.0.0/0`, IP Protocol TCP, Destination Port `80`; rồi một quy tắc nữa cho cổng `443`.

(Tường lửa bên trong máy thì kịch bản cài tự mở.)

## Bước 2: Trỏ tên miền về máy

Ở nơi quản lý tên miền, thêm bản ghi **A**: tên `@` (hoặc `app` nếu muốn dùng `app.ten-mien.vn`), giá trị là **Public IP** của máy Oracle. Chờ 5–30 phút.

## Bước 3: Vào máy và cài

Trên Windows mở PowerShell (máy Mac mở Terminal):

```bash
ssh -i duong-dan-toi-file-khoa.key ubuntu@IP_CUA_MAY
```

Trong máy Oracle:

```bash
git clone -b claude/wonderful-carson-w464oh https://github.com/khoatay/mobile.git
```

Nếu kho code để riêng tư, GitHub hỏi tên đăng nhập và mật khẩu: mật khẩu là một **Personal access token** (GitHub → Settings → Developer settings → Personal access tokens), không phải mật khẩu GitHub.

```bash
sudo bash mobile/server/deploy/install.sh ten-mien-cua-ban.vn
```

Thay `ten-mien-cua-ban.vn` bằng tên miền thật. Cuối cùng thấy dòng `{"ok":true,...}` là xong phần cài.

## Bước 4: Điền khoá

```bash
sudo nano /opt/golden-duck/.env
```

Điền `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TG_API_ID`, `TG_API_HASH`. Lưu: `Ctrl+O`, Enter, `Ctrl+X`. Rồi:

```bash
sudo systemctl restart golden-duck
```

File này chứa bí mật: không chụp màn hình gửi ai, không đưa lên git.

## Bước 5: Đăng nhập tài khoản đọc kênh

```bash
sudo bash /opt/golden-duck/app/server/deploy/tg-login.sh
```

Nhập số điện thoại riêng (dạng `+84…`), mã Telegram gửi về, mật khẩu hai lớp nếu có. Thấy `"telegram":true` là được.

## Bước 6: Thử

1. Mở `https://ten-mien-cua-ban.vn` trên điện thoại, tạo tài khoản.
2. Tín hiệu → dán `@tên` một kênh công khai → Thêm. Tên kênh hiện ra là máy chủ đã vào kênh.
3. Tài khoản → Nối Telegram → bấm Start trong bot.
4. Hỏi AI → hỏi thử một câu.

Trên điện thoại, mở trang bằng trình duyệt → Chia sẻ → **Thêm vào màn hình chính** để dùng như app.

## Việc hằng ngày

| Việc | Lệnh |
|---|---|
| Xem máy chủ có chạy không | `curl -s localhost:8080/api/health` |
| Xem nhật ký lỗi | `sudo journalctl -u golden-duck -n 100 --no-pager` |
| Khởi động lại | `sudo systemctl restart golden-duck` |
| Cập nhật bản mới | `cd ~/mobile && git pull && sudo bash server/deploy/update.sh` |
| Nâng khách lên Pro (tạm thời, trước khi có thanh toán) | `sudo sqlite3 /opt/golden-duck/data/golden-duck.db "update users set plan='pro', plan_until=strftime('%s','now','+30 days')*1000 where email='khach@mail.com'"` |
| Xem chi phí AI hôm nay | `sudo sqlite3 /opt/golden-duck/data/golden-duck.db "select sum(calls), round(sum(cost),3) from ai_usage where day=date('now')"` |

Sao lưu chạy tự động 3 giờ sáng mỗi ngày vào `/opt/golden-duck/backup` (giữ 14 ngày). Thỉnh thoảng tải một bản về máy mình:

```bash
scp -i file-khoa.key ubuntu@IP_CUA_MAY:/opt/golden-duck/backup/golden-duck-*.db .
```

## Gặp lỗi

| Thấy | Làm |
|---|---|
| Trang không mở được | Kiểm tra Bước 1 (cổng 80, 443) và Bước 2 (bản ghi A đúng IP). `sudo journalctl -u caddy -n 50` |
| "Máy chủ chưa nối được Telegram" | Chạy lại Bước 5 |
| Thêm kênh báo "Telegram đang giới hạn" | Telegram hạn chế vào quá nhiều kênh một lúc; đợi vài phút |
| Kênh báo "đã đầy kênh" | Một tài khoản Telegram vào được khoảng 500 kênh; khi gần tới mức này cần thêm tài khoản đọc thứ hai |
| AI báo lỗi | Kiểm tra khoá và số dư ở console.anthropic.com |
