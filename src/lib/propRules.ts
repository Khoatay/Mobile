/**
 * Các luật quỹ ngoài lỗ ngày/lỗ tổng: lot tối đa còn được vào, luật nhất quán, tin mạnh, giữ lệnh cuối tuần, rút lợi nhuận.
 * Hàm thuần, thời gian lệnh là giờ máy chủ lưu như UTC (giống phần còn lại của app).
 */
import { calcPosition, parseSymbol } from './forex'
import type { CalEvent } from './news'
import type { PropConfig, PropDay } from './prop'
import type { Trade } from './types'

const DAY = 86_400_000

/** Lot tối đa để nếu chạm SL thì vẫn chưa dùng hết `room` (khoảng còn được lỗ). null nếu không tính được. */
export function maxLotForRoom(room: number, symbol: string, slPips: number, accountCcy: string, quotes: Record<string, number>, leverage = 100): number | null {
  if (!(room > 0) || !(slPips > 0) || !Number.isFinite(room)) return null
  const r = calcPosition({ symbol, accountCcy, balance: room, riskPct: 100, slPips, leverage, quotes })
  return r ? r.lots : null
}

export interface Consistency { bestDay: number; bestDate: string; totalProfit: number; share: number; limitPct: number; ok: boolean; /** Lãi cần thêm (không có ngày nào lãi lớn hơn) để ngày tốt nhất về dưới giới hạn. */ needMore: number }

/** Luật nhất quán: lãi ngày tốt nhất / tổng lãi ≤ X%. Tổng lãi là lãi ròng từ đầu (âm hoặc 0 thì chưa áp dụng). */
export function consistency(days: PropDay[], limitPct: number): Consistency | null {
  if (!(limitPct > 0)) return null
  const total = days.reduce((s, d) => s + d.net, 0)
  const best = days.reduce((b, d) => (d.net > b.net ? d : b), { net: 0, date: '' } as Pick<PropDay, 'net' | 'date'>)
  const share = total > 0 ? best.net / total : 0
  const needMore = total > 0 ? Math.max(0, best.net / (limitPct / 100) - total) : 0
  return { bestDay: best.net, bestDate: best.date, totalProfit: total, share, limitPct, ok: total <= 0 || share <= limitPct / 100 + 1e-9, needMore }
}

/** Lệnh đã giữ qua cuối tuần: còn mở qua thứ Bảy (giờ máy chủ). */
export function heldOverWeekend(trades: Trade[]): Trade[] {
  return trades.filter((t) => {
    const open = new Date(t.openTime)
    const day0 = Date.UTC(open.getUTCFullYear(), open.getUTCMonth(), open.getUTCDate())
    // 0h thứ Bảy đầu tiên kể từ ngày mở lệnh (mở ngay thứ Bảy thì là chính ngày đó).
    const sat = day0 + ((6 - open.getUTCDay() + 7) % 7) * DAY
    return t.closeTime > sat
  })
}

/** Sắp tới cuối tuần: từ 18:00 thứ Sáu giờ máy chủ trở đi (thị trường thường đóng khoảng 23:00–24:00). */
export function nearWeekend(nowServer: number): { near: boolean; hoursLeft: number } {
  const d = new Date(nowServer)
  if (d.getUTCDay() !== 5) return { near: d.getUTCDay() === 6, hoursLeft: 0 }
  const close = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 55)
  const hoursLeft = (close - nowServer) / 3_600_000
  return { near: d.getUTCHours() >= 18, hoursLeft: Math.max(0, hoursLeft) }
}

/** Đồng tiền mà một cặp chịu ảnh hưởng của tin (vàng, bạc tính theo USD). */
function newsCurrencies(symbol: string): string[] {
  const info = parseSymbol(symbol)
  if (!info) return []
  return [info.base, info.quote].map((c) => (c === 'XAU' || c === 'XAG' ? 'USD' : c))
}

export interface NewsHit { event: CalEvent; trade?: Trade; what: 'open' | 'close' }

/**
 * Lệnh mở hoặc đóng trong ±`windowMin` phút quanh tin mức cao của đồng tiền liên quan.
 * Lịch tin là giờ thật (ISO có múi giờ); `serverOffset` đổi sang giờ máy chủ để so với giờ lệnh.
 */
export function newsViolations(trades: Trade[], events: CalEvent[], windowMin: number, serverOffset: number): NewsHit[] {
  if (!(windowMin > 0)) return []
  const w = windowMin * 60_000
  const high = events.filter((e) => e.impact === 'High' && Number.isFinite(Date.parse(e.date)))
  const out: NewsHit[] = []
  for (const t of trades) {
    const ccys = newsCurrencies(t.symbol)
    for (const e of high) {
      if (!ccys.includes(e.currency)) continue
      const at = Date.parse(e.date) + serverOffset * 3_600_000
      if (Math.abs(t.openTime - at) <= w) out.push({ event: e, trade: t, what: 'open' })
      else if (Math.abs(t.closeTime - at) <= w) out.push({ event: e, trade: t, what: 'close' })
    }
  }
  return out
}

/** Tin mức cao sắp ra trong `aheadMin` phút tới, của đồng tiền thuộc các cặp đang giao dịch (now là giờ thật). */
export function upcomingNews(events: CalEvent[], symbols: string[], now: number, aheadMin = 120): CalEvent[] {
  const ccys = new Set(symbols.flatMap(newsCurrencies))
  return events
    .filter((e) => e.impact === 'High' && ccys.has(e.currency))
    .filter((e) => { const t = Date.parse(e.date); return t >= now - 5 * 60_000 && t - now <= aheadMin * 60_000 })
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
}

export interface Payout { profit: number; share: number; capped: boolean; withdrawable: number; nextDate: string | null; daysToNext: number | null }

/**
 * Rút lợi nhuận tài khoản đã cấp vốn: lãi trên vốn ban đầu × % chia, có trần mỗi lần rút; ngày rút tiếp theo theo chu kỳ.
 * `fromDate`: lần rút gần nhất, hoặc ngày bắt đầu.
 */
export function payout(cfg: Pick<PropConfig, 'accountSize' | 'profitSplitPct' | 'payoutDays' | 'payoutCapPct' | 'lastPayout' | 'startDate'>, balance: number, nowServer: number): Payout | null {
  if (!(cfg.profitSplitPct > 0)) return null
  const profit = Math.max(0, balance - cfg.accountSize)
  const cap = cfg.payoutCapPct > 0 ? (cfg.accountSize * cfg.payoutCapPct) / 100 : Infinity
  const base = Math.min(profit, cap)
  const from = cfg.lastPayout || cfg.startDate
  let nextDate: string | null = null, daysToNext: number | null = null
  if (cfg.payoutDays > 0 && from) {
    const next = Date.parse(from + 'T00:00:00Z') + cfg.payoutDays * DAY
    nextDate = new Date(next).toISOString().slice(0, 10)
    daysToNext = Math.max(0, Math.ceil((next - nowServer) / DAY))
  }
  return { profit, share: cfg.profitSplitPct / 100, capped: profit > cap, withdrawable: (base * cfg.profitSplitPct) / 100, nextDate, daysToNext }
}
