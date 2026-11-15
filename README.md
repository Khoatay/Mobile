# FX Desk

Công cụ cho người giao dịch forex, chạy trên trình duyệt máy tính. Dữ liệu lưu ngay trong trình duyệt (localStorage), không gửi lên máy chủ nào.

## Chức năng

- **Tính lot**: từ số dư, % rủi ro và stop loss (theo pip hoặc theo giá) ra khối lượng lệnh, giá trị pip, ký quỹ và R:R. Hỗ trợ 28 cặp tiền, vàng, bạc, và tài khoản không phải USD.
- **Nhật ký lệnh**: import báo cáo HTML của MT5 và MT4, hoặc CSV; nhập tay; gắn setup và ghi chú; xuất CSV.
- **Thống kê**: lãi/lỗ ròng, tỷ lệ thắng, profit factor, kỳ vọng, sụt giảm lớn nhất, R trung bình, đường lãi/lỗ luỹ kế, và phân tích theo cặp, phiên, ngày trong tuần, thời gian giữ lệnh, chiều lệnh, setup.

## Chạy

Cần Node.js 20 trở lên.

```bash
npm install
npm run dev      # mở địa chỉ được in ra, thường là http://localhost:5173
npm test         # kiểm thử phần tính toán và đọc file
npm run build    # bản tĩnh trong thư mục dist/
```

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
