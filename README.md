# FX Desk

Công cụ cho người giao dịch forex, chạy trên trình duyệt máy tính. Dữ liệu lưu ngay trong trình duyệt (localStorage), không gửi lên máy chủ nào.

## Chức năng

- **Tính lot**: từ số dư, % rủi ro và stop loss (theo pip hoặc theo giá) ra khối lượng lệnh, giá trị pip, ký quỹ và R:R. Hỗ trợ 28 cặp tiền, vàng, bạc, và tài khoản không phải USD.
- **Nhật ký lệnh**: import báo cáo HTML của MT5 và MT4, hoặc CSV; nhập tay; gắn setup và ghi chú; xuất CSV.
- **Thống kê**: xem tất cả, theo nhóm (Real, Quỹ A…) hoặc từng tài khoản, kèm bảng so sánh; lãi/lỗ ròng, tỷ lệ thắng, profit factor, kỳ vọng, sụt giảm lớn nhất, R trung bình, đường lãi/lỗ luỹ kế, và phân tích theo cặp, phiên, ngày trong tuần, thời gian giữ lệnh, chiều lệnh, setup.
- **Quỹ**: chỉ hiện tài khoản có vai trò Quỹ, mỗi quỹ một tab với chấm màu trạng thái; chương trình và cỡ tài khoản được đoán sẵn từ broker, giai đoạn và số dư. Theo dõi mục tiêu lãi, giới hạn lỗ ngày và lỗ tổng cho FTMO, The5ers, TenTrade hoặc luật tự đặt. Chỉ tính trên lệnh đã đóng, và thông số mẫu cần được đối chiếu với điều khoản của quỹ.
- **Tài khoản** (cần bridge): mỗi tài khoản một tab; tab của tài khoản quỹ có luôn phần theo dõi quỹ ngay bên dưới, thêm và gỡ tài khoản ngay trên app; gắn nhãn broker, Real/Demo, vai trò, giai đoạn (vòng 1, vòng 2…), nhóm và ghi chú. Xem nhiều tài khoản cùng lúc (thật, quỹ, copy trade, demo) với số dư, equity, lệnh đang mở; đưa lịch sử lệnh vào Nhật ký; cập nhật tỷ giá cho Tính lot. Thống kê và Quỹ tách được theo từng tài khoản, và phần Quỹ tính cả lãi/lỗ đang treo.
- **Vào lệnh từ app** (mặc định tắt): lệnh thị trường với stop loss bắt buộc, lot tự tính theo % rủi ro, và nút đóng lệnh. Chỉ dùng được với tài khoản đã bật riêng trong bridge.
- **Tín hiệu Telegram** (cần bridge): đọc lệnh từ các kênh bạn chọn, gom theo cặp tiền, đánh giá độ trùng khớp giữa các kênh và với xu hướng H4, và chấm thành tích từng kênh bằng dữ liệu giá từ MT5.
- **Bảo vệ** (miễn phí, cần bridge): bridge theo dõi 3 giây một lần, kể cả khi app đóng. Giới hạn lấy từ luật quỹ hoặc tự đặt theo % số dư; lỗ ngày tính từ số dư đầu ngày, hoặc số cao hơn giữa số dư và equity đầu ngày (kiểu The5ers). Cảnh báo ở hai ngưỡng; ở ngưỡng hành động thì đóng hết lệnh và khoá vào lệnh tới hết ngày máy chủ. Khoá cả khi thua liên tiếp N lệnh hoặc vào quá số lệnh trong ngày; đang khoá mà mở lệnh mới từ MT5 thì tự đóng.
  - **SL khẩn cấp trên sàn**: gắn/siết SL cho mọi lệnh sao cho nếu tất cả cùng chạm SL thì vẫn chưa vượt ngưỡng hành động. SL nằm trên máy chủ sàn nên vẫn chặn khi máy tắt. Chỉ siết, không bao giờ nới SL bạn đặt. Không chống được trượt giá khi giá nhảy cóc.
  - **Khoá cứng**: khoá vì chạm giới hạn lỗ không mở tay được tới hết ngày; khoá vì thua liên tiếp/quá số lệnh phải chờ 30 phút. Đang khoá cứng thì không tắt được bảo vệ. (Tắt hẳn bridge thì vẫn thoát được: đây là công cụ kỷ luật, không phải luật của quỹ.)
- **Copy lệnh** (cần bridge): một tài khoản nguồn, nhiều tài khoản nhận; lot theo hệ số, theo tỷ lệ số dư hoặc cố định; chép mở, đóng, SL/TP; có chế độ chép ngược chiều. Chỉ chép lệnh mở sau khi bật.
- **Nhận xét từ nhật ký** (trang Thống kê): tự tìm thói quen gây lỗ: vào lệnh gỡ trong 15 phút sau lệnh thua, ngày giao dịch quá nhiều, gồng lệnh lỗ lâu hơn lệnh lãi, lỗ vượt SL, lệnh không đặt SL, và phiên/ngày/cặp/setup/thời gian giữ kém nhất. Chỉ kết luận khi nhóm có từ 8 lệnh.
- **Thành tích công khai**: xuất một trang HTML độc lập (đường cong, bảng tháng, lệnh gần nhất, nút link giới thiệu) kèm mã SHA-256 của dữ liệu; có thể ẩn số tiền.
- **Đăng tự động** (tab trong Chia sẻ, cần bridge + Telegram): lịch tin buổi sáng, kết quả lệnh vừa đóng kèm ảnh, thống kê cuối tuần; đăng ngay hoặc duyệt trước. Chỉ chạy khi app đang mở.
- **Golden Duck Talk** (cần bridge + khoá API của một nhà cung cấp AI): tạo nhân vật của riêng bạn với tính cách, giá trị/phẩm giá, cách nói chuyện, giới hạn, câu chào, hội thoại mẫu; gắn các bộ kiến thức đã học; tuỳ chọn cho nhân vật xem thống kê và lệnh đang mở. Nhân vật luôn trung thực rằng mình là AI, không hứa lợi nhuận, không cổ vũ gỡ lỗ. Lưu ở `bridge/knowledge/personas.json`.
- **AI học trade** (cần bridge và khoá API): tạo bộ kiến thức cho từng phương pháp (ICT, SMC, kết hợp…), nạp PDF, ghi chú và phụ đề video, dạy agent qua trò chuyện. Agent tóm thành một bộ quy tắc rõ ràng, sửa tay được, đánh dấu những điều nó tự suy ra.
- **AI phân tích** (cần bridge, MT5 và khoá API): chọn bộ kiến thức và danh sách cặp tiền; app tính sẵn các đặc điểm giá từ nến D1/H4/H1/M15 (cấu trúc, BOS/CHoCH, FVG, order block, thanh khoản, đỉnh đáy ngày và tuần trước, biên phiên Á) rồi agent chỉ áp đúng bộ quy tắc đó, cho ra xu hướng chính, thiên hướng từng khung, bảng kiểm tra điều kiện, và lệnh đề xuất kèm khối lượng theo % rủi ro, hoặc nói rõ cần chờ gì.
- **Cửa hàng**: bot trade (EA MT5), indicator MT5 và TradingView, khoá học, tài liệu; ảnh, nhãn, giá, giá cũ, điểm nổi bật, link mua.
- **Nhóm cộng đồng**: các kênh và nhóm Telegram của IB với quà, điều kiện tham gia và nút vào nhóm.
- **Ưu đãi**: ảnh feature, một ưu đãi nổi bật, danh sách ưu đãi của sàn, quỹ và công cụ (mã giảm giá, hạn dùng, ghim), tự dùng link giới thiệu đã lưu, sao chép hoặc gửi bài lên Telegram; ưu đãi hết hạn tự ẩn.
- **Hồ sơ**: ảnh đại diện, tên hiển thị, tên người dùng, giới thiệu, phong cách và thị trường giao dịch. Hiện lưu trên máy; đăng nhập sẽ có khi nối máy chủ.
- **Tin tức**: lịch kinh tế tuần này (lọc theo mức độ và theo đồng tiền đang giữ lệnh, cảnh báo tin mạnh sắp ra), và luồng tin từ các kênh Telegram.
- **Thu chi đầu tư**: ghi khoản bỏ ra (phí quỹ, nạp tài khoản, công cụ, khoá học) và thu về (rút từ quỹ, từ tài khoản, backcom, affiliate); lấy nạp/rút từ MT5; tính lãi/lỗ tổng và tỷ suất trên tiền bỏ ra.
- **Chia sẻ cộng đồng**: tạo banner và nội dung cho tín hiệu, kết quả lệnh, thống kê theo ngày/tuần/tháng; tải ảnh, sao chép, hoặc gửi thẳng lên nhóm Telegram trong danh sách cho phép.
- **Hướng dẫn** và **Cá nhân hoá**: bài hướng dẫn dùng app, kết nối, quỹ (cách vận hành, luật từng chương trình), sàn và giao dịch cơ bản, kèm nút mở link giới thiệu của bạn; link IB, affiliate và mã giảm giá khai báo một chỗ ở Cá nhân hoá; thư viện link bài viết, video của riêng bạn; tên thương hiệu, màu, link giới thiệu, dòng cảnh báo, ẩn số tiền khi chia sẻ.

## Bản IB và bản trader

- **Gói Pro**: một trang duy nhất cho mọi thứ liên quan tới Pro. Trader xem tính năng nào là Pro, đã mở hay chưa, giá và nút nâng cấp. IB chọn tính năng nào là Pro (đăng tín hiệu từ AI phân tích, chép tín hiệu từ Telegram, AI phân tích, AI học trade, Tín hiệu Telegram), đặt giá và link nâng cấp, và quản lý link giới thiệu cùng gói cấu hình ngay tại đây. Trang bị khoá hiện màn hình giới thiệu Pro; mục bị khoá trong thanh bên có biểu tượng khoá nhỏ.
- **Bản IB** (mặc định, `npm run build`): chỉnh link giới thiệu (link, mã, chữ trên nút, câu giới thiệu, ẩn/hiện, thêm đối tác), ưu đãi, cửa hàng, nhóm cộng đồng và cài đặt Pro; xuất gói cấu hình `brand.json`. Công tắc "Xem như người dùng" ở cuối thanh bên để xem giao diện của trader.
- **Bản trader** (`npm run build:trader`, ra thư mục `dist-trader/`): chỉ xem. Đọc `brand.json` đóng gói cùng app, hoặc từ link đặt bằng `VITE_BRAND_URL` (ví dụ một GitHub Gist), nên sửa gói là người dùng thấy bản mới mà không phải cài lại.
- Việc chặn tính năng Pro hiện dựa vào gói cấu hình (`proForAll`), chưa có xác minh theo từng người; xác minh thật cần máy chủ và đăng nhập.

## Bản xem trước

`VITE_PREVIEW=1 npm run build -- --outDir dist-preview` build app với bridge giả lập ngay trong trang (tài khoản, tin Telegram, lịch kinh tế, câu trả lời AI đều là mẫu), để xem thử mọi trang mà không cần MT5 hay khoá API.

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

- **MT5**: cách dễ nhất là chạy `python bridge.py` (bridge tự tạo `config.json` trống nếu chưa có), rồi thêm tài khoản ở tab "+ Thêm tài khoản" trong app; bridge tự lưu vào `config.json`. Hoặc tự khai báo từng tài khoản trong `accounts`: nhãn, loại (`real`, `prop`, `copy`, `demo`), số tài khoản, mật khẩu view (investor), tên máy chủ và `terminal_path`. Mật khẩu view chỉ cho xem, không đặt lệnh được.
- **Mỗi tài khoản cần một bản MT5 ở thư mục riêng**, vì một bản MT5 chỉ đăng nhập được một tài khoản tại một thời điểm. Cài MT5 thêm lần nữa vào thư mục khác (bộ cài của mỗi quỹ thường đã vào thư mục riêng), hoặc sao chép cả thư mục MT5 và đặt `"portable": true`.
- **Vào lệnh**: chỉ với tài khoản có `"allow_trading": true` và dùng mật khẩu giao dịch thay cho mật khẩu view. `max_lot` (mặc định 1.0) là trần khối lượng mỗi lệnh. Bridge từ chối lệnh không có stop loss, và luôn để MT5 kiểm tra lệnh trước khi gửi. Hãy thử trên tài khoản demo trước, và kiểm tra điều khoản của quỹ về việc đặt lệnh bằng phần mềm ngoài.
- **Telegram**: lấy `api_id` và `api_hash` tại my.telegram.org, rồi điền tên các kênh vào `channels`. Bridge đọc bằng tài khoản Telegram của bạn, nên chỉ thấy kênh công khai hoặc kênh bạn đã tham gia.
- **AI**: chọn nhà cung cấp bằng `"ai_provider"`, điền `"ai_api_key"` và `"ai_model"` trong `config.json`:

  | `ai_provider` | Lấy khoá ở | `ai_model` |
  |---|---|---|
  | `anthropic` (mặc định) | console.anthropic.com | mặc định `claude-opus-5-5` |
  | `openai` | platform.openai.com | bắt buộc ghi, theo danh sách model của OpenAI |
  | `deepseek` | platform.deepseek.com | mặc định `deepseek-chat` |
  | `gemini` | aistudio.google.com | bắt buộc ghi |
  | `openrouter` | openrouter.ai (một khoá dùng được nhiều hãng) | bắt buộc ghi, ví dụ `deepseek/deepseek-chat` |
  | `ollama` | không cần khoá, model chạy trên máy (ollama.com) | bắt buộc ghi, ví dụ `qwen2.5:14b` |
  | `custom` | máy chủ bất kỳ có API kiểu OpenAI, kèm `"ai_base_url"` | bắt buộc ghi |

  Config cũ chỉ có `"anthropic_api_key"` vẫn chạy như trước. Tuỳ chọn thêm: `"ai_base_url"` (đổi địa chỉ máy chủ), `"ai_max_tokens"`, `"ai_json_mode"` (`schema`, `object` hoặc `none`, đổi khi model báo lỗi định dạng trả lời).
  - **PDF** được lấy chữ ngay trên máy (thư viện `pypdf`) và gửi dạng chữ, rẻ hơn vài lần so với gửi nguyên file. PDF ảnh scan không có chữ: Claude vẫn đọc được nguyên file; các model khác thì cần chuyển sang chữ (OCR) rồi nạp file `.txt`. Muốn Claude xem cả hình và biểu đồ trong PDF thì đặt `"pdf_mode": "full"` (đắt hơn).
  - Phần AI phân tích cần model làm đúng quy tắc và trả JSON ổn định. Model nhỏ hoặc chạy trên máy có thể trả lời kém hơn, nên thử vài lần trước khi tin dùng.
  - Bộ kiến thức và tài liệu lưu trong `bridge/knowledge/` (không đưa lên git). Mỗi lần dạy hoặc phân tích tốn phí API theo lượng chữ gửi đi, và tài liệu được gửi tới máy chủ của nhà cung cấp bạn chọn.
- **Gửi bài**: liệt kê tên nhóm được phép gửi trong `post_targets`. Bridge từ chối gửi tới bất kỳ nơi nào khác, kể cả các kênh đang đọc.
- **Lịch kinh tế**: bridge tải từ nguồn công khai của Forex Factory, cần máy có internet.
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
