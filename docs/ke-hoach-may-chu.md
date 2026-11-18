# Kế hoạch máy chủ Golden Duck (bản thương mại cho trader)

Bản IB vẫn chạy như hiện nay: bridge trên máy của IB, khoá API của IB. Tài liệu này là phần **máy chủ** cho bản thương mại: khách dùng điện thoại, đăng nhập, tự thêm kênh Telegram muốn theo dõi rồi chép lệnh.

## Quyết định chính

| Việc | Chọn | Lý do |
|---|---|---|
| Máy chủ | VPS Hostinger (Ubuntu 24.04), tên miền mua cùng chỗ | Máy chủ ở nước ngoài, thanh toán quốc tế, tiện làm bản tiếng Anh và các thứ tiếng khác. Oracle miễn phí không dùng được |
| Ngôn ngữ máy chủ | Node 22 + TypeScript | Dùng lại thẳng code trong `src/lib/` (đọc lệnh từ tin nhắn, chấm kênh, tính lot, luật quỹ), khỏi viết lại hai lần |
| Cơ sở dữ liệu | SQLite có sẵn trong Node (`node:sqlite`), một file | Không cần cài thêm, sao lưu bằng cách chép một file; đủ cho vài nghìn khách |
| HTTPS | Caddy (tự lấy chứng chỉ Let's Encrypt cho tên miền) | Cấu hình 3 dòng, tự gia hạn |
| Đọc kênh Telegram | Một tài khoản Telegram riêng (số điện thoại riêng) đăng nhập trên máy chủ bằng GramJS | Đọc được mọi kênh tài khoản đó tham gia, kể cả kênh của người khác; bot chỉ đọc được kênh mà nó làm quản trị |
| Kênh nào được đọc | **Khách tự thêm** bằng @tên, link t.me hoặc link mời; chủ app không đề xuất kênh | Theo yêu cầu. Nhiều khách thêm cùng một kênh thì máy chủ chỉ tham gia và đọc một lần |
| Cảnh báo | Một bot Telegram chung của Golden Duck; khách nối bằng một lần bấm Start | Có máy chủ thì một bot dùng chung được (không còn cảnh giành tin như khi mỗi bridge tự nghe) |
| AI | Khoá API của chủ app nằm trên máy chủ; đếm chi phí và giới hạn lượt theo gói | Khoá không bao giờ tới máy khách nên không bị lấy cắp |
| Vào lệnh MT5 | Qua bridge: (1) bridge trên máy tính của khách, hoặc (2) một VPS Windows của chủ app chạy MT5 cho khách chỉ có điện thoại. Bridge kết nối **ra** máy chủ, nên không cần mở cổng | Thư viện điều khiển MT5 chỉ chạy trên Windows; máy chủ chính là Linux. Dịch vụ MT5 đám mây (MetaApi…) tính khoảng 10–12 € mỗi tài khoản mỗi tháng cộng phí gói (số của bên thứ ba), đắt hơn giá Pro dự kiến; VPS Windows 10–25 USD/tháng chạy được 15–30 tài khoản |

## Giai đoạn

**Giai đoạn 1: chạy được trên VPS, chưa vào lệnh** (đang làm)
- Đặt web app lên tên miền, có HTTPS.
- Đăng ký, đăng nhập bằng email và mật khẩu (băm scrypt, phiên trong cookie httpOnly).
- Khách tự thêm, xoá kênh; máy chủ tham gia kênh, lưu tin, đọc lệnh, chấm điểm kênh như bản IB.
- Bot chung: khách bấm Start để nối; lệnh mới ở kênh đã bật thông báo thì báo về Telegram.
- AI (Golden Duck Talk) qua máy chủ, giới hạn lượt mỗi ngày theo gói.

**Giai đoạn 2: chép lệnh**
- Bridge thêm chế độ "nối máy chủ": mở kết nối WebSocket ra máy chủ bằng mã của khách, nhận lệnh cần vào, trả kết quả.
- "Bấm để chép": nút trong app và nút ngay dưới tin báo của bot.
- "Tự chép" với rào chắn: chỉ kênh được bật, bỏ lệnh không có SL, lot theo % rủi ro có trần, bỏ qua nếu giá đã đi quá xa giá vào, giới hạn số lệnh mỗi ngày, tôn trọng Bảo vệ.
- VPS Windows của chủ app khi đã có khách cần chép mà không có máy tính.

**Giai đoạn 3: thu phí**
- Gói Free / Pro, hạn dùng, giới hạn theo gói.
- Thanh toán chuyển khoản VietQR, tự xác nhận qua webhook của cổng (PayOS hoặc tương đương) khi chủ app có tài khoản doanh nghiệp.

## Chi phí hằng tháng

| Khoản | Chi phí |
|---|---|
| VPS Hostinger | theo gói (trả trước nhiều năm rẻ hơn, gia hạn đắt hơn) |
| Tên miền | đã có |
| Số điện thoại cho tài khoản đọc kênh | một SIM riêng |
| AI | theo lượng dùng; chat bằng Haiku khoảng 10–25đ mỗi tin |
| VPS Windows (giai đoạn 2, khi cần) | khoảng 10–25 USD |

## Bảo mật

- Mật khẩu khách: băm scrypt, không lưu dạng thường.
- Khoá AI, mã bot, phiên Telegram: chỉ nằm trong file `.env` và thư mục dữ liệu trên máy chủ, không đưa lên git.
- Mật khẩu giao dịch MT5 (giai đoạn 2): không đi qua máy chủ khi khách dùng bridge của chính họ; với VPS của chủ app thì mã hoá khi lưu và khuyên khách dùng tài khoản riêng cho copy, nạp ít tiền.
- Chỉ chép lệnh cho chính khách từ kênh khách tự chọn; app không phát lại tín hiệu của kênh người khác cho người không theo kênh đó.

## Vận hành

- Một tiến trình Node chạy bằng systemd, tự khởi động lại khi lỗi hoặc khi máy khởi động.
- Sao lưu: chép file `data/golden-duck.db` mỗi ngày (cron).
- Hướng dẫn cài từng bước: `server/HUONG-DAN-CAI.md`.
