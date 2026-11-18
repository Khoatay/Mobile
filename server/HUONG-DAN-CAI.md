# Cài Golden Duck lên VPS Hostinger (từng bước)

Làm một lần, khoảng 30–45 phút. Không cần biết lập trình: chỉ chép từng lệnh dán vào cửa sổ dòng lệnh.

## Cần chuẩn bị

| Thứ | Lấy ở đâu |
|---|---|
| VPS Hostinger gói KVM (2 nhân, 8 GB RAM là thoải mái; gói nhỏ nhất cũng chạy được). Hệ điều hành: **Ubuntu 24.04 bản trống** (Plain OS), không chọn bản cài sẵn panel. Vị trí máy: chọn nơi gần châu Á nhất trong danh sách Hostinger cho chọn | hostinger.com → VPS |
| Tên miền (.com rẻ, mua luôn trên Hostinger, bật bảo vệ thông tin chủ sở hữu WHOIS) | hostinger.com → Domains |
| Tên miền của bạn | nơi bạn mua tên miền |
| Khoá AI | console.anthropic.com → API Keys (nạp tiền trước, ví dụ 10 USD) |
| Bot Telegram | Telegram → @BotFather → `/newbot` → đặt tên, ví dụ `GoldenDuckBot` → nhận mã bot |
| Một số điện thoại riêng cho tài khoản đọc kênh | SIM riêng, tạo một tài khoản Telegram mới bằng số này |
| API ID / API Hash của tài khoản đó | my.telegram.org → đăng nhập bằng số riêng → API development tools → tạo app |

Tài khoản đọc kênh nên là số **riêng**, không dùng Telegram cá nhân của bạn: máy chủ sẽ tự vào mọi kênh khách thêm.

## Bước 1: Lấy thông tin đăng nhập máy

hPanel → VPS → máy của bạn → Overview: ghi lại **IP** và đặt **mật khẩu root**.

Nếu đã bật Firewall trong hPanel (VPS → Security → Firewall) thì thêm quy tắc cho phép cổng **22, 80, 443** (TCP). Chưa bật thì bỏ qua.

## Bước 2: Trỏ tên miền về máy

hPanel → Domains → tên miền → DNS / Nameservers: sửa bản ghi **A** tên `@` (hoặc thêm `app` nếu muốn dùng `app.ten-mien.com`), giá trị là **IP** của VPS. Xoá bản ghi A cũ trỏ chỗ khác nếu có. Chờ 5–30 phút.

## Bước 3: Vào máy và cài

Trên Windows mở PowerShell (máy Mac mở Terminal):

```bash
ssh root@IP_CUA_MAY
```

Nhập mật khẩu root (gõ không hiện chữ, cứ gõ rồi Enter). Hoặc dùng nút **Browser terminal** trong hPanel.

Trong máy:

```bash
git clone -b claude/vibe-code-trader-finance-jtwj46 https://github.com/khoatay/mobile.git
```

Nếu kho code để riêng tư, GitHub hỏi tên đăng nhập và mật khẩu: mật khẩu là một **Personal access token** (GitHub → Settings → Developer settings → Personal access tokens), không phải mật khẩu GitHub.

```bash
sudo bash mobile/server/deploy/install.sh ten-mien-cua-ban.com
```

Thay `ten-mien-cua-ban.com` bằng tên miền thật. Cuối cùng thấy dòng `{"ok":true,...}` là xong phần cài.

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

1. Mở `https://ten-mien-cua-ban.com` trên điện thoại, tạo tài khoản.
2. Tín hiệu → dán `@tên` một kênh công khai → Thêm. Tên kênh hiện ra là máy chủ đã vào kênh.
3. Tài khoản → Nối Telegram → bấm Start trong bot.
4. Hỏi AI → hỏi thử một câu.

Trang web là bản đầy đủ của Golden Duck: khách đăng nhập rồi dùng mọi trang. Gói Pro, Golden Duck Talk và kênh tín hiệu chạy trên máy chủ.

Các trang cần MT5 (Tài khoản, Bảo vệ, Copy lệnh, AI học trade, AI phân tích) dùng **bridge trên máy Windows của khách** (PC hoặc VPS Windows họ thuê). Bridge tự nối lên máy chủ, khách không phải mở cổng:
1. Khách vào **Tài khoản & gói → Kết nối máy MT5 → Tạo mã kết nối**.
2. Dán dòng `"server": {...}` hiện ra vào `bridge/config.json` trên máy đó, chạy lại bridge.

Máy chủ chặn tính năng Pro trước khi chuyển xuống bridge. AI học trade và AI phân tích của bridge dùng khoá Claude của bạn (model ở ô "mạnh" trong trang Quản trị), giới hạn lượt mỗi ngày bằng `FREE_BRIDGE_AI_PER_DAY` và `PRO_BRIDGE_AI_PER_DAY` trong `.env` (mặc định 3 và 50).

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
scp root@IP_CUA_MAY:/opt/golden-duck/backup/golden-duck-*.db .
```

## Gặp lỗi

| Thấy | Làm |
|---|---|
| Trang không mở được | Kiểm tra Bước 1 (Firewall hPanel mở 80, 443) và Bước 2 (bản ghi A đúng IP). `sudo journalctl -u caddy -n 50` |
| "Máy chủ chưa nối được Telegram" | Chạy lại Bước 5 |
| Thêm kênh báo "Telegram đang giới hạn" | Telegram hạn chế vào quá nhiều kênh một lúc; đợi vài phút |
| Kênh báo "đã đầy kênh" | Một tài khoản Telegram vào được khoảng 500 kênh; khi gần tới mức này cần thêm tài khoản đọc thứ hai |
| AI báo lỗi | Kiểm tra khoá và số dư ở console.anthropic.com |
