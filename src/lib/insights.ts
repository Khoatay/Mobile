import { holdOf, rMultiple, sessionOf, weekdayOf } from './stats'
import { netOf, type Trade } from './types'

export interface Insight {
  id: string
  tone: 'bad' | 'good' | 'info'
  title: string
  detail: string
  /** Độ ảnh hưởng để xếp hạng: số tiền chênh lệch ước tính. */
  impact: number
}

const MIN = 8
const pct = (v: number) => `${Math.round(v * 100)}%`
const money = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const winRate = (l: Trade[]) => (l.length ? l.filter((t) => netOf(t) > 0).length / l.length : 0)
const sum = (l: Trade[]) => l.reduce((s, t) => s + netOf(t), 0)

/**
 * Tìm thói quen trong nhật ký: chuỗi thua, trade trả thù, ngày vào quá nhiều lệnh, gồng lỗ, lỗ vượt SL,
 * lệnh không SL, và nhóm (phiên, ngày, cặp, setup) kéo kết quả xuống hoặc đẩy lên. Chỉ kết luận khi đủ mẫu.
 */
export function computeInsights(input: Trade[], serverOffset: number): Insight[] {
  const trades = [...input].sort((a, b) => a.closeTime - b.closeTime)
  const out: Insight[] = []
  if (trades.length < MIN * 2) return out
  const baseWr = winRate(trades)

  // 1. Lệnh ngay sau hai lệnh thua liên tiếp
  const afterStreak: Trade[] = []
  for (let i = 2; i < trades.length; i++) if (netOf(trades[i - 1]) < 0 && netOf(trades[i - 2]) < 0) afterStreak.push(trades[i])
  if (afterStreak.length >= MIN) {
    const wr = winRate(afterStreak)
    if (wr <= baseWr - 0.1) out.push({ id: 'streak', tone: 'bad', impact: Math.abs(sum(afterStreak)), title: 'Sau hai lệnh thua, bạn trade kém hẳn đi', detail: `Lệnh ngay sau hai lệnh thua liên tiếp chỉ thắng ${pct(wr)}, so với ${pct(baseWr)} bình thường (${afterStreak.length} lệnh, tổng ${money(sum(afterStreak))}). Cân nhắc dừng hết ngày sau hai lệnh thua; trang Bảo vệ khoá tự động được.` })
  }

  // 2. Trade trả thù: mở trong vòng 15 phút sau khi một lệnh thua đóng
  const revenge: Trade[] = [], calm: Trade[] = []
  for (const t of trades) {
    const prevLoss = trades.some((p) => p !== t && netOf(p) < 0 && p.closeTime <= t.openTime && t.openTime - p.closeTime <= 15 * 60_000)
    ;(prevLoss ? revenge : calm).push(t)
  }
  if (revenge.length >= MIN && calm.length >= MIN) {
    const a = sum(revenge) / revenge.length, b = sum(calm) / calm.length
    if (a < b && a < 0) out.push({ id: 'revenge', tone: 'bad', impact: Math.abs(sum(revenge)), title: 'Dấu hiệu trade trả thù', detail: `${revenge.length} lệnh được mở trong vòng 15 phút sau một lệnh thua. Trung bình mỗi lệnh này ${money(a)}, trong khi các lệnh khác ${money(b)}. Nghỉ ít nhất 15 phút sau mỗi lệnh thua.` })
  }

  // 3. Ngày vào quá nhiều lệnh
  const byDay = new Map<string, Trade[]>()
  for (const t of trades) { const k = new Date(t.openTime).toISOString().slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), t]) }
  const days = [...byDay.values()]
  if (days.length >= 10) {
    const avg = trades.length / days.length
    const busy = days.filter((d) => d.length >= Math.max(4, Math.ceil(avg * 1.8)))
    const normal = days.filter((d) => !busy.includes(d))
    if (busy.length >= 3 && normal.length >= 3) {
      const a = busy.reduce((s, d) => s + sum(d), 0) / busy.length, b = normal.reduce((s, d) => s + sum(d), 0) / normal.length
      if (a < b) out.push({ id: 'overtrade', tone: a < 0 ? 'bad' : 'info', impact: Math.abs(a - b) * busy.length, title: 'Ngày vào nhiều lệnh là ngày kém', detail: `${busy.length} ngày bạn vào từ ${Math.max(4, Math.ceil(avg * 1.8))} lệnh trở lên, trung bình mỗi ngày đó ${money(a)}; những ngày khác ${money(b)}. Đặt giới hạn số lệnh mỗi ngày ở trang Bảo vệ.` })
    }
  }

  // 4. Gồng lỗ: giữ lệnh thua lâu hơn hẳn lệnh thắng
  const wins = trades.filter((t) => netOf(t) > 0), losses = trades.filter((t) => netOf(t) < 0)
  if (wins.length >= MIN && losses.length >= MIN) {
    const hold = (l: Trade[]) => l.reduce((s, t) => s + (t.closeTime - t.openTime), 0) / l.length
    const hw = hold(wins), hl = hold(losses)
    const h = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} phút` : `${(ms / 3_600_000).toFixed(1)} giờ`)
    if (hl > hw * 1.5) out.push({ id: 'hold', tone: 'bad', impact: Math.abs(sum(losses)) * 0.2, title: 'Bạn giữ lệnh thua lâu hơn lệnh thắng', detail: `Lệnh thua giữ trung bình ${h(hl)}, lệnh thắng ${h(hw)}. Thường đây là dấu hiệu chờ giá quay lại thay vì cắt theo kế hoạch.` })
    else if (hw > hl * 1.5) out.push({ id: 'hold-good', tone: 'good', impact: 0, title: 'Cắt lỗ nhanh, để lãi chạy', detail: `Lệnh thắng giữ trung bình ${h(hw)}, lệnh thua chỉ ${h(hl)}. Giữ thói quen này.` })
  }

  // 5. Lỗ vượt quá SL đã đặt (dời SL hoặc trượt giá lớn)
  const withSl = trades.filter((t) => rMultiple(t) != null)
  const beyond = withSl.filter((t) => (rMultiple(t) ?? 0) < -1.15)
  if (withSl.length >= MIN && beyond.length >= 3 && beyond.length / withSl.length >= 0.1) out.push({ id: 'beyond-sl', tone: 'bad', impact: Math.abs(sum(beyond)), title: 'Nhiều lệnh lỗ vượt quá stop loss', detail: `${beyond.length} lệnh lỗ nhiều hơn 1.15R (tổng ${money(sum(beyond))}). Có thể do dời SL xa hơn hoặc giữ lệnh qua tin mạnh.` })

  // 6. Lệnh không đặt SL
  const noSl = trades.filter((t) => !(t.sl > 0))
  if (noSl.length / trades.length >= 0.25) out.push({ id: 'no-sl', tone: noSl.length / trades.length >= 0.5 ? 'bad' : 'info', impact: Math.abs(Math.min(0, sum(noSl))), title: `${pct(noSl.length / trades.length)} số lệnh không có stop loss`, detail: `Không có SL thì không tính được rủi ro mỗi lệnh, và một lệnh có thể xoá sạch nhiều ngày lãi. Tổng lãi/lỗ của nhóm lệnh này ${money(sum(noSl))}.` })

  // 7. Nhóm kéo xuống và nhóm đẩy lên: phiên, ngày trong tuần, cặp, setup, thời gian giữ
  const groupings: [string, string, (t: Trade) => string | undefined][] = [
    ['session', 'phiên', (t) => sessionOf(t.openTime, serverOffset)],
    ['weekday', 'ngày', (t) => weekdayOf(t.openTime)],
    ['symbol', 'cặp', (t) => t.symbol],
    ['setup', 'setup', (t) => t.setup?.trim() || undefined],
    ['hold', 'thời gian giữ', (t) => holdOf(t)],
  ]
  const total = sum(trades)
  for (const [id, label, key] of groupings) {
    const g = new Map<string, Trade[]>()
    for (const t of trades) { const k = key(t); if (k) g.set(k, [...(g.get(k) ?? []), t]) }
    const groups = [...g.entries()].filter(([, l]) => l.length >= MIN)
    if (groups.length < 2) continue
    const worst = groups.reduce((a, b) => (sum(b[1]) < sum(a[1]) ? b : a))
    const best = groups.reduce((a, b) => (sum(b[1]) > sum(a[1]) ? b : a))
    if (sum(worst[1]) < 0 && (total > 0 || winRate(worst[1]) <= baseWr - 0.12)) {
      out.push({ id: `${id}-worst`, tone: 'bad', impact: Math.abs(sum(worst[1])), title: `${cap(label)} kém nhất: ${worst[0]}`, detail: `${worst[1].length} lệnh, thắng ${pct(winRate(worst[1]))}, tổng ${money(sum(worst[1]))}. Bỏ ${label} này thì tổng kết quả thành ${money(total - sum(worst[1]))}.` })
    }
    if (sum(best[1]) > 0 && best[0] !== worst[0] && sum(best[1]) >= Math.abs(total) * 0.4) {
      out.push({ id: `${id}-best`, tone: 'good', impact: sum(best[1]) * 0.5, title: `${cap(label)} tốt nhất: ${best[0]}`, detail: `${best[1].length} lệnh, thắng ${pct(winRate(best[1]))}, tổng ${money(sum(best[1]))}. Đây là chỗ bạn có lợi thế rõ nhất.` })
    }
  }

  const rank = { bad: 0, info: 1, good: 2 }
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || b.impact - a.impact)
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
