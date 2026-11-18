# Hướng dẫn khách cài Golden Duck Bridge (Windows)

File chưa có chữ ký số nên trình duyệt và Windows sẽ cảnh báo. Các bước đã thử thật trên máy chủ app (11/2026):

1. Trên web: **Tài khoản & gói → Kết nối máy chạy MT5 → Cài Golden Duck Bridge → ⬇ Tải GoldenDuckBridge.exe**.
2. Trình duyệt báo file không thường được tải xuống: trong danh sách tải xuống, bấm **mũi tên ▾ cạnh nút Delete → Keep anyway** (Chrome: **Keep**).
3. Bấm đúp vào file. Hiện bảng xanh **"Windows protected your PC"**: bấm dòng chữ nhỏ **More info → Run anyway**.
4. Trang cài đặt tự mở trong trình duyệt. Trên web bấm **Tạo mã kết nối → Chép mã**, dán vào ô **Kết nối Golden Duck → Lưu và kết nối**.
5. Thêm tài khoản MT5 ở trang **Tài khoản** trên web (mỗi tài khoản một bản MT5 cài ở thư mục riêng).

Chương trình chạy ngầm (biểu tượng con vịt ở góc phải Taskbar) và tự chạy khi bật máy.

## Nếu vẫn bị chặn

- **Smart App Control** (Windows 11) hoặc Windows Security báo virus rồi xoá file: bản Windows đó chặn hẳn ứng dụng chưa ký số. Không khuyên khách tắt diệt virus; tạm dùng bản Python, và cần ký số file .exe (Microsoft Trusted Signing khoảng 10 USD/tháng, hoặc chứng chỉ thường 100–300 USD/năm) để hết hẳn cảnh báo.

## Chỉ cần một bản MT5 cho mọi sàn và quỹ

Bridge tự tạo bản MT5 riêng cho mỗi tài khoản bằng cách chép một MT5 đã cài (kể cả danh sách máy chủ). MT5 nào cũng nối được mọi sàn, miễn là nó biết máy chủ của sàn đó. Với mỗi sàn/quỹ mới, làm một lần trên MT5 đang có:

**File → Open an Account → gõ tên sàn/quỹ (ví dụ FTMO) → chọn → Next → Connect with an existing trade account → nhập tài khoản, mật khẩu, máy chủ → Finish.**

Đăng nhập được một lần là MT5 nhớ máy chủ của sàn đó; sau đó thêm tài khoản trên web như bình thường. Nếu chưa làm bước này, bridge sẽ báo rõ cần làm gì thay vì tạo bản MT5 không đăng nhập được.
