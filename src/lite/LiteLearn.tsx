const RULES = [
  ['Luôn đặt cắt lỗ (stop loss)', 'Quyết định trước sẽ chịu mất bao nhiêu, rồi để MT5 tự đóng lệnh khi giá chạm mức đó.'],
  ['Mỗi lệnh chỉ rủi ro 0.5–1% vốn', 'Vốn 1.000 USD thì mỗi lệnh chỉ chấp nhận mất 5–10 USD. Dùng mục "Tính lệnh" để ra số lot.'],
  ['Thua 2 lệnh liền thì nghỉ', 'Sau khi thua, người ta hay vào lệnh vội để gỡ. Đó là lúc dễ mất tiền nhất.'],
  ['Tập trên demo trước', 'Tài khoản demo dùng tiền ảo, giá thật. Có lãi đều trên demo vài tuần rồi hãy dùng tiền thật.'],
  ['Không vay tiền để trade', 'Chỉ dùng số tiền mà mất hết cũng không ảnh hưởng tới cuộc sống.'],
]

const TERMS: [string, string][] = [
  ['Pip', 'Bước giá nhỏ nhất thường dùng để đo giá đã chạy bao xa. EURUSD từ 1.0800 lên 1.0820 là 20 pip. Với vàng, 1 pip = 0.1 giá (từ 2600.0 lên 2605.0 là 50 pip).'],
  ['Lot', 'Khối lượng lệnh. 1 lot vàng là 100 ounce: giá đi 1 đô thì lãi/lỗ 100 USD. 0.01 lot (lot nhỏ nhất) thì chỉ 1 USD.'],
  ['Buy / Sell (Mua / Bán)', 'Mua khi nghĩ giá sẽ lên, Bán khi nghĩ giá sẽ xuống. Trong forex bạn có thể kiếm tiền cả khi giá giảm.'],
  ['Stop loss (SL, cắt lỗ)', 'Mức giá mà lệnh tự đóng để chặn lỗ. Không đặt SL là để tài khoản không có phanh.'],
  ['Take profit (TP, chốt lời)', 'Mức giá mà lệnh tự đóng để giữ tiền lãi.'],
  ['Đòn bẩy (leverage)', 'Sàn cho bạn mở lệnh lớn hơn số vốn. Đòn bẩy 1:100 nghĩa là 1.000 USD mở được lệnh trị giá 100.000 USD. Lãi nhanh thì lỗ cũng nhanh.'],
  ['Ký quỹ (margin)', 'Phần vốn sàn tạm giữ khi bạn mở lệnh. Hết ký quỹ thì sàn tự đóng lệnh của bạn (cháy tài khoản).'],
  ['Spread', 'Chênh lệch giữa giá mua và giá bán, là phí ẩn của sàn. Vừa vào lệnh bạn đã lỗ một chút bằng đúng spread.'],
  ['Số dư và equity', 'Số dư (balance) là tiền khi không có lệnh mở. Equity là số dư cộng lãi/lỗ của các lệnh đang mở, tức số tiền thật nếu đóng hết ngay.'],
  ['Quỹ (prop firm)', 'Công ty cấp vốn cho bạn trade nếu bạn vượt qua bài thi, rồi chia lợi nhuận. Bài thi có luật lỗ tối đa mỗi ngày và tổng; vi phạm là mất tài khoản.'],
]

export default function LiteLearn({ goFull }: { goFull: (tab?: string) => void }) {
  return (
    <>
      <h1>Học cơ bản</h1>
      <section className="lite-card">
        <div className="lite-label">5 điều cần nhớ</div>
        <ol className="lite-rules">
          {RULES.map(([title, detail]) => <li key={title}><strong>{title}</strong><p>{detail}</p></li>)}
        </ol>
      </section>

      <section className="lite-card">
        <div className="lite-label">Từ điển cho người mới</div>
        <div className="lite-terms">
          {TERMS.map(([term, meaning]) => (
            <details key={term}>
              <summary>{term}</summary>
              <p>{meaning}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lite-card">
        <p>Muốn tìm hiểu sâu hơn về sàn, quỹ và cách dùng từng chức năng?</p>
        <button className="lite-link" onClick={() => goFull('guides')}>Mở bài hướng dẫn đầy đủ →</button>
      </section>
      <p className="muted small">Giao dịch forex và vàng có rủi ro mất vốn. Nội dung ở đây để học, không phải lời khuyên đầu tư.</p>
    </>
  )
}
