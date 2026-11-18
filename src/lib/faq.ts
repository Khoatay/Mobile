/**
 * Câu trả lời soạn sẵn cho các câu hỏi cơ bản của người mới ("pip là gì", "lot là gì"…).
 * Trả lời ngay, không gọi AI nên không tốn tiền và không tính lượt. Câu hỏi dài, có số liệu
 * hay hỏi về tài khoản riêng thì để AI trả lời.
 */

/** Bỏ dấu, viết thường, bỏ ký tự lạ: "Stop loss là gì?" -> "stop loss la gi". */
export const fold = (s: string) => ` ${s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `

interface Faq { keys: string[]; answer: string }

const FAQ: Faq[] = [
  { keys: [' pip '], answer: '**Pip** là bước giá dùng để đo giá đã chạy bao xa.\n- EURUSD từ 1.0800 lên 1.0820 là 20 pip.\n- Vàng (XAUUSD): 1 pip = 0.1 giá, nên 10 pip = 1 giá. Vàng từ 2600 lên 2605 là 50 pip.' },
  { keys: [' lot '], answer: '**Lot** là khối lượng lệnh.\n- 1 lot vàng = 100 ounce: giá đi 1 đô thì lãi/lỗ 100 USD.\n- 0.01 lot (nhỏ nhất) thì giá đi 1 đô chỉ lãi/lỗ 1 USD.\nMới học thì vào 0.01 lot. Muốn biết vốn của mình nên vào bao nhiêu, dùng mục **Tính lệnh**.' },
  { keys: [' stop loss ', ' cat lo ', ' dung lo ', ' sl '], answer: '**Stop loss (cắt lỗ)** là mức giá lệnh tự đóng để chặn lỗ.\n- Đặt ở chỗ mà nếu giá chạm tới thì ý tưởng vào lệnh của bạn đã sai (ví dụ dưới đáy gần nhất khi Mua).\n- Từ khoảng cách SL mới tính ra số lot, sao cho mất tối đa 0.5–1% vốn. Mục **Tính lệnh** làm việc này cho bạn.\n- Lệnh không có SL thì đừng vào.' },
  { keys: [' take profit ', ' chot loi ', ' chot lai ', ' tp '], answer: '**Take profit (chốt lời)** là mức giá lệnh tự đóng để giữ tiền lãi. Thường đặt sao cho khoảng cách TP gấp 1.5–2 lần khoảng cách SL: thắng một lệnh bù được nhiều hơn một lệnh thua.' },
  { keys: [' don bay ', ' leverage '], answer: '**Đòn bẩy** cho bạn mở lệnh lớn hơn số vốn. 1:100 nghĩa là 1.000 USD mở được lệnh trị giá 100.000 USD. Đòn bẩy không làm tăng rủi ro nếu bạn tính lot đúng; cái nguy hiểm là vào lot quá to so với vốn.' },
  { keys: [' ky quy ', ' margin '], answer: '**Ký quỹ (margin)** là phần vốn sàn tạm giữ khi bạn mở lệnh. Lỗ tới mức hết ký quỹ thì sàn tự đóng lệnh (cháy tài khoản). Vào lot nhỏ và luôn có SL để không bao giờ tới mức đó.' },
  { keys: [' spread '], answer: '**Spread** là chênh lệch giữa giá mua và giá bán, là phí ẩn của sàn. Vừa vào lệnh bạn đã lỗ đúng bằng spread. Spread thường giãn rộng lúc ra tin mạnh và lúc mở cửa thị trường.' },
  { keys: [' equity ', ' so du '], answer: '**Số dư (balance)** là tiền khi không có lệnh mở. **Equity** là số dư cộng lãi/lỗ của các lệnh đang mở, tức số tiền thật nếu đóng hết ngay bây giờ.' },
  { keys: [' prop firm ', ' quy cap von ', ' quy la gi ', ' thi quy '], answer: '**Quỹ (prop firm)** cấp vốn cho bạn trade nếu bạn vượt bài thi, rồi chia lợi nhuận. Bài thi có luật lỗ tối đa mỗi ngày và lỗ tổng; vi phạm một lần là mất tài khoản. Nên tập kỷ luật trên demo trước khi thi.' },
  { keys: [' demo '], answer: '**Tài khoản demo** dùng tiền ảo nhưng giá thật. Khác tài khoản thật ở chỗ không mất tiền thật, và tâm lý nhẹ hơn nhiều. Có lãi đều trên demo vài tuần, rồi chuyển sang tiền thật với số vốn nhỏ.' },
  { keys: [' buy ', ' sell ', ' mua ban '], answer: '**Buy (Mua)** khi bạn nghĩ giá sẽ lên, **Sell (Bán)** khi nghĩ giá sẽ xuống. Trong forex bạn kiếm tiền được cả khi giá giảm, và lỗ được cả hai chiều.' },
  { keys: [' thua 2 lenh ', ' thua hai lenh ', ' thua lien ', ' thua may lenh '], answer: 'Thua 2 lệnh liền thì **nghỉ hết hôm nay**. Sau khi thua người ta hay vào lệnh vội để gỡ, và đó là lúc dễ mất tiền nhất. Mai xem lại 2 lệnh đó: có đúng kế hoạch không, SL có hợp lý không.' },
]

const FOOTER = '\n\n_Trả lời soạn sẵn, không tính lượt. Hỏi cụ thể hơn (kèm số liệu của bạn) để AI trả lời riêng._'

/** Câu trả lời soạn sẵn nếu câu hỏi ngắn, chung chung và khớp chủ đề; không thì null (để AI trả lời). */
export function cannedAnswer(question: string): string | null {
  const q = fold(question)
  // Có số (vốn 100 đô, SL 30 giá…) hoặc dài thì là câu hỏi riêng: để AI trả lời.
  const hits = FAQ.filter((f) => f.keys.some((k) => q.includes(k)))
  // Số nằm ngoài cụm từ khoá ("thua 2 lệnh" thì được) là câu hỏi có số liệu riêng.
  const rest = hits.reduce((s, h) => h.keys.reduce((t, k) => t.split(k).join(' '), s), q)
  if (q.length > 60 || /\d/.test(rest)) return null
  if (!hits.length || hits.length > 3) return null
  return hits.map((h) => h.answer).join('\n\n') + FOOTER
}
