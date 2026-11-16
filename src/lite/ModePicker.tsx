import type { Mode } from './plain'

/** Hỏi một lần khi mở app lần đầu. Đổi lại được bất cứ lúc nào bằng nút ở góc trên (bản đơn giản) hoặc thanh bên (bản đầy đủ). */
export default function ModePicker({ brand, onPick }: { brand: string; onPick: (m: Mode) => void }) {
  return (
    <div className="mode-picker">
      <span className="logo" aria-hidden="true">{(brand || 'FX').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || 'FX'}</span>
      <h1>Chào mừng tới {brand || 'FX Desk'}</h1>
      <p className="muted">Bạn muốn dùng giao diện nào? Đổi lại lúc nào cũng được.</p>
      <div className="mode-options">
        <button className="mode-option" onClick={() => onPick('lite')}>
          <span className="mode-tag">Khuyên dùng cho người mới</span>
          <strong>Đơn giản</strong>
          <ul>
            <li>Tính lệnh trong 4 bước, nói bằng tiền</li>
            <li>Xem lãi/lỗ và lời khuyên dễ hiểu</li>
            <li>Từ điển cho người mới</li>
          </ul>
        </button>
        <button className="mode-option" onClick={() => onPick('full')}>
          <span className="mode-tag dim">Cho trader có kinh nghiệm</span>
          <strong>Đầy đủ</strong>
          <ul>
            <li>Nối MT5, nhiều tài khoản, quỹ</li>
            <li>Bảo vệ tài khoản, copy lệnh</li>
            <li>Tín hiệu Telegram, AI phân tích</li>
          </ul>
        </button>
      </div>
    </div>
  )
}
