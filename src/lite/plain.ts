/**
 * Logic cho bản đơn giản: đổi các con số kỹ thuật sang lời nói dễ hiểu cho người mới.
 * Không phụ thuộc giao diện, có kiểm thử ở plain.test.ts.
 */
import { parseSymbol, pipSize } from '../lib/forex'
import { netOf, type Trade } from '../lib/types'

export type Mode = 'lite' | 'full'

export interface RiskLevel { pct: number; label: string; note: string }

/** Ba mức rủi ro dựng sẵn, người mới chỉ cần bấm chọn. */
export const RISK_LEVELS: RiskLevel[] = [
  { pct: 0.5, label: 'An toàn', note: 'Nên dùng khi mới bắt đầu' },
  { pct: 1, label: 'Vừa phải', note: 'Mức phổ biến của trader lâu năm' },
  { pct: 2, label: 'Mạo hiểm', note: 'Thua 5 lệnh liền là mất gần 10% vốn' },
]

/** Cặp hay dùng nhất, hiện thành nút bấm thay vì danh sách 30 cặp. */
export const POPULAR = [
  { symbol: 'XAUUSD', name: 'Vàng' },
  { symbol: 'EURUSD', name: 'Euro / Đô' },
  { symbol: 'GBPUSD', name: 'Bảng Anh / Đô' },
  { symbol: 'USDJPY', name: 'Đô / Yên' },
]

/** Stop loss gợi ý theo loại cặp (tính bằng pip): vàng biến động mạnh hơn nên cần khoảng rộng hơn. */
export function slPresets(symbol: string): { pips: number; label: string }[] {
  const info = parseSymbol(symbol)
  if (info?.base === 'XAU') return [{ pips: 30, label: 'Gần' }, { pips: 50, label: 'Vừa' }, { pips: 100, label: 'Xa' }]
  if (info?.base === 'XAG') return [{ pips: 15, label: 'Gần' }, { pips: 30, label: 'Vừa' }, { pips: 50, label: 'Xa' }]
  return [{ pips: 10, label: 'Gần' }, { pips: 20, label: 'Vừa' }, { pips: 30, label: 'Xa' }]
}

/** "50 pip vàng" → "giá đi 5.00" để người mới hình dung trên biểu đồ. */
export function priceMove(symbol: string, pips: number): string {
  const info = parseSymbol(symbol)
  if (!info || !(pips > 0)) return ''
  const size = pipSize(info)
  const digits = Math.max(0, -Math.floor(Math.log10(size)))
  return (pips * size).toFixed(digits)
}

/** Mức rủi ro người dùng đang đặt thuộc nhóm nào, để cảnh báo bằng lời. */
export function riskTone(pct: number): 'ok' | 'high' | 'danger' {
  if (pct > 3) return 'danger'
  if (pct > 2) return 'high'
  return 'ok'
}

/** Tổng lãi/lỗ của các lệnh đóng từ mốc `from` (epoch ms, cùng hệ giờ với closeTime). */
export function pnlSince(trades: Trade[], from: number): { net: number; n: number } {
  let net = 0, n = 0
  for (const t of trades) if (t.closeTime >= from) { net += netOf(t); n++ }
  return { net, n }
}

/**
 * Mốc đầu ngày và đầu tuần (thứ 2) theo giờ máy chủ.
 * closeTime lưu giờ máy chủ như thể là UTC, nên "bây giờ" cũng phải dời theo múi giờ máy chủ.
 */
export function periodStarts(now: number, serverOffset: number): { day: number; week: number } {
  const d = new Date(now + serverOffset * 3_600_000)
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const week = day - ((d.getUTCDay() + 6) % 7) * 86_400_000
  return { day, week }
}

/** Một câu nhận xét tổng quát, không dùng thuật ngữ. */
export function verdict(s: { n: number; net: number; winRate: number; avgWin: number; avgLoss: number }): string {
  if (s.n === 0) return 'Chưa có lệnh nào.'
  if (s.n < 20) return `Mới có ${s.n} lệnh, còn quá ít để kết luận. Cứ ghi chép đều, từ khoảng 20 lệnh trở lên con số mới có ý nghĩa.`
  const ratio = s.avgLoss > 0 ? s.avgWin / s.avgLoss : 0
  if (s.net > 0 && ratio >= 1) return 'Bạn đang có lãi, và mỗi lệnh thắng mang về nhiều hơn mỗi lệnh thua lấy đi. Giữ nguyên kỷ luật này.'
  if (s.net > 0) return 'Bạn đang có lãi nhờ thắng nhiều lệnh, nhưng mỗi lệnh thua lấy đi nhiều hơn mỗi lệnh thắng mang về. Thử cắt lỗ sớm hơn.'
  if (s.winRate >= 0.5) return 'Bạn thắng nhiều lệnh hơn thua nhưng tổng vẫn lỗ: lệnh thua đang quá lớn. Luôn đặt stop loss và không dời nó ra xa.'
  return 'Bạn đang lỗ. Hãy giảm mức rủi ro xuống "An toàn" và xem phần "Điều nên chú ý" bên dưới.'
}
