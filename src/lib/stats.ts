import { netOf, type Trade } from './types'

export interface Group { key: string; n: number; net: number; wins: number; winRate: number }

export interface Stats {
  n: number
  wins: number
  losses: number
  winRate: number
  net: number
  grossProfit: number
  grossLoss: number
  /** Infinity nếu không có lệnh thua. */
  profitFactor: number
  avgWin: number
  avgLoss: number
  payoff: number
  expectancy: number
  maxDrawdown: number
  maxLosingStreak: number
  avgR: number | null
  rCount: number
  avgHoldMs: number
  equity: { t: number; v: number }[]
  bySymbol: Group[]
  bySession: Group[]
  byWeekday: Group[]
  bySide: Group[]
  byHold: Group[]
  bySetup: Group[]
}

export const SESSIONS = ['Á (00–07 UTC)', 'Âu (07–12 UTC)', 'Âu–Mỹ (12–16 UTC)', 'Mỹ (16–21 UTC)', 'Cuối ngày (21–24 UTC)']
export const WEEKDAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']
export const HOLDS = ['< 15 phút', '15 phút – 1 giờ', '1 – 4 giờ', '4 – 24 giờ', '> 1 ngày']

const HOUR = 3_600_000

/** Phiên theo giờ MỞ lệnh, quy về UTC từ giờ máy chủ. Không điều chỉnh giờ mùa hè. */
export function sessionOf(openTime: number, serverOffset: number): string {
  const h = new Date(openTime - serverOffset * HOUR).getUTCHours()
  return SESSIONS[h < 7 ? 0 : h < 12 ? 1 : h < 16 ? 2 : h < 21 ? 3 : 4]
}

export function weekdayOf(openTime: number): string {
  return WEEKDAYS[(new Date(openTime).getUTCDay() + 6) % 7]
}

export function holdOf(t: Trade): string {
  const h = (t.closeTime - t.openTime) / HOUR
  return HOLDS[h < 0.25 ? 0 : h < 1 ? 1 : h < 4 ? 2 : h < 24 ? 3 : 4]
}

/**
 * R theo biến động giá so với khoảng cách SL (chưa gồm phí/swap).
 * Trả null nếu không có SL hoặc SL đã bị dời sang phía có lãi (không còn là rủi ro ban đầu).
 */
export function rMultiple(t: Trade): number | null {
  if (!(t.sl > 0)) return null
  const dir = t.side === 'buy' ? 1 : -1
  const risk = (t.openPrice - t.sl) * dir
  if (!(risk > 0)) return null
  return ((t.closePrice - t.openPrice) * dir) / risk
}

function group(trades: Trade[], keyOf: (t: Trade) => string | undefined, order?: string[]): Group[] {
  const map = new Map<string, Group>()
  for (const t of trades) {
    const key = keyOf(t)
    if (!key) continue
    const g = map.get(key) ?? { key, n: 0, net: 0, wins: 0, winRate: 0 }
    const net = netOf(t)
    g.n++
    g.net += net
    if (net > 0) g.wins++
    map.set(key, g)
  }
  const out = [...map.values()]
  for (const g of out) g.winRate = g.wins / g.n
  if (order) return out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return out.sort((a, b) => b.net - a.net)
}

export function computeStats(input: Trade[], serverOffset: number): Stats {
  const trades = [...input].sort((a, b) => a.closeTime - b.closeTime)
  let wins = 0, losses = 0, grossProfit = 0, grossLoss = 0
  let cum = 0, peak = 0, maxDrawdown = 0, streak = 0, maxLosingStreak = 0
  let rSum = 0, rCount = 0, holdSum = 0
  const equity: Stats['equity'] = []
  for (const t of trades) {
    const net = netOf(t)
    if (net > 0) { wins++; grossProfit += net; streak = 0 }
    else if (net < 0) { losses++; grossLoss -= net; streak++; maxLosingStreak = Math.max(maxLosingStreak, streak) }
    cum += net
    peak = Math.max(peak, cum)
    maxDrawdown = Math.max(maxDrawdown, peak - cum)
    equity.push({ t: t.closeTime, v: cum })
    const r = rMultiple(t)
    if (r != null) { rSum += r; rCount++ }
    holdSum += t.closeTime - t.openTime
  }
  const n = trades.length
  const avgWin = wins ? grossProfit / wins : 0
  const avgLoss = losses ? grossLoss / losses : 0
  return {
    n, wins, losses,
    winRate: n ? wins / n : 0,
    net: cum, grossProfit, grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin, avgLoss,
    payoff: avgLoss > 0 ? avgWin / avgLoss : 0,
    expectancy: n ? cum / n : 0,
    maxDrawdown, maxLosingStreak,
    avgR: rCount ? rSum / rCount : null,
    rCount,
    avgHoldMs: n ? holdSum / n : 0,
    equity,
    bySymbol: group(trades, (t) => t.symbol),
    bySession: group(trades, (t) => sessionOf(t.openTime, serverOffset), SESSIONS),
    byWeekday: group(trades, (t) => weekdayOf(t.openTime), WEEKDAYS),
    bySide: group(trades, (t) => (t.side === 'buy' ? 'Buy' : 'Sell'), ['Buy', 'Sell']),
    byHold: group(trades, holdOf, HOLDS),
    bySetup: group(trades, (t) => t.setup?.trim() || undefined),
  }
}
