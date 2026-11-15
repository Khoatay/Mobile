# FX Desk

Công cụ cho người giao dịch forex, chạy trên trình duyệt máy tính. Dữ liệu lưu ngay trong trình duyệt (localStorage), không gửi lên máy chủ nào.

## Chức năng

- **Tính lot**: từ số dư, % rủi ro và stop loss (theo pip hoặc theo giá) ra khối lượng lệnh, giá trị pip, ký quỹ và R:R. Hỗ trợ 28 cặp tiền, vàng, bạc, và tài khoản không phải USD.
- **Nhật ký lệnh**: import báo cáo HTML của MT5 và MT4, hoặc CSV; nhập tay; gắn setup và ghi chú; xuất CSV.
- **Thống kê**: lãi/lỗ ròng, tỷ lệ thắng, profit factor, kỳ vọng, sụt giảm lớn nhất, R trung bình, đường lãi/lỗ luỹ kế, và phân tích theo cặp, phiên, ngày trong tuần, thời gian giữ lệnh, chiều lệnh, setup.
- **Luật quỹ**: theo dõi mục tiêu lãi, giới hạn lỗ ngày và lỗ tổng cho FTMO, The5ers, TenTrade hoặc luật tự đặt. Chỉ tính trên lệnh đã đóng, và thông số mẫu cần được đối chiếu với điều khoản của quỹ.
- **Tài khoản MT5** (cần bridge): xem nhiều tài khoản cùng lúc (thật, quỹ, copy trade, demo) với số dư, equity, lệnh đang mở; đưa lịch sử lệnh vào Nhật ký; cập nhật tỷ giá cho Tính lot. Thống kê và Luật quỹ tách được theo từng tài khoản, và Luật quỹ tính cả lãi/lỗ đang treo.
- **Vào lệnh từ app** (mặc định tắt): lệnh thị trường với stop loss bắt buộc, lot tự tính theo % rủi ro, và nút đóng lệnh. Chỉ dùng được với tài khoản đã bật riêng trong bridge.
- **Tín hiệu Telegram** (cần bridge): đọc lệnh từ các kênh bạn chọn, gom theo cặp tiền, đánh giá độ trùng khớp giữa các kênh và với xu hướng H4, và chấm thành tích từng kênh bằng dữ liệu giá từ MT5.

## Chạy

Cần Node.js 20 trở lên.

```bash
npm install
npm run dev      # mở địa chỉ được in ra, thường là http://localhost:5173
npm test         # kiểm thử phần tính toán và đọc file
npm run build    # bản tĩnh trong thư mục dist/
```

## Bridge: kết nối MT5 và Telegram

Trình duyệt không tự đăng nhập MT5 hay Telegram được. `bridge/bridge.py` là chương trình nền chạy trên máy Windows có cài MT5. Nó chỉ mở cổng trên `127.0.0.1` và từ chối yêu cầu từ trang web không chạy trên chính máy này.

```bash
cd bridge
pip install -r requirements.txt
copy config.example.json config.json    # rồi điền thông tin
python bridge.py login                  # chỉ khi dùng Telegram: đăng nhập lần đầu, in danh sách kênh
python bridge.py
```

- **MT5**: khai báo từng tài khoản trong `accounts`: nhãn, loại (`real`, `prop`, `copy`, `demo`), số tài khoản, mật khẩu view (investor), tên máy chủ và `terminal_path`. Mật khẩu view chỉ cho xem, không đặt lệnh được.
- **Mỗi tài khoản cần một bản MT5 ở thư mục riêng**, vì một bản MT5 chỉ đăng nhập được một tài khoản tại một thời điểm. Cài MT5 thêm lần nữa vào thư mục khác (bộ cài của mỗi quỹ thường đã vào thư mục riêng), hoặc sao chép cả thư mục MT5 và đặt `"portable": true`.
- **Vào lệnh**: chỉ với tài khoản có `"allow_trading": true` và dùng mật khẩu giao dịch thay cho mật khẩu view. `max_lot` (mặc định 1.0) là trần khối lượng mỗi lệnh. Bridge từ chối lệnh không có stop loss, và luôn để MT5 kiểm tra lệnh trước khi gửi. Hãy thử trên tài khoản demo trước, và kiểm tra điều khoản của quỹ về việc đặt lệnh bằng phần mềm ngoài.
- **Telegram**: lấy `api_id` và `api_hash` tại my.telegram.org, rồi điền tên các kênh vào `channels`. Bridge đọc bằng tài khoản Telegram của bạn, nên chỉ thấy kênh công khai hoặc kênh bạn đã tham gia.
- `config.json` và file phiên Telegram chứa thông tin đăng nhập; chúng đã được loại khỏi git. Đừng gửi cho ai.

Việc đọc lệnh từ tin nhắn dùng quy tắc cố định (cặp tiền, Buy/Sell, giá vào, SL, TP, tiếng Anh và tiếng Việt). Tin viết theo kiểu lạ có thể bị bỏ sót hoặc đọc sai, nên hãy xem cột "Tin gốc" trước khi tin vào kết quả.

## Lấy file lịch sử lệnh

- **MT5**: tab History → chuột phải → Report → HTML.
- **MT4**: tab Account History → chuột phải → Save as Report.
- **CSV**: tải file mẫu trong trang Nhật ký để xem tên cột.

## Lưu ý

- Tỷ giá ban đầu là giá trị mẫu. Hãy cập nhật trước khi tính lệnh thật.
- Quy ước pip: 0.0001; cặp JPY 0.01; vàng 0.1 (1 lot = 100 oz); bạc 0.01 (1 lot = 5000 oz). Một số broker dùng quy ước khác cho kim loại.
- Phiên giao dịch tính theo giờ UTC, quy đổi từ múi giờ máy chủ đặt trong trang Nhật ký, không điều chỉnh giờ mùa hè.
- R dùng mức stop loss ghi trong báo cáo, tức mức cuối cùng của lệnh.

## Cấu trúc

- `src/lib/` — logic thuần (tính lot, đọc file, thống kê), không phụ thuộc giao diện, dùng lại được cho bản điện thoại.
- `src/pages/`, `src/components/` — giao diện React.
- `bridge/` — chương trình nền Python; chỉ chuyển dữ liệu thô, mọi phép tính nằm ở `src/lib/`.
