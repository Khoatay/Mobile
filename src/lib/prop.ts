import { netOf, type Trade } from './types'

export interface PropConfig {
  preset: string
  accountSize: number
  /** Chỉ tính lệnh đóng từ ngày này (yyyy-mm-dd, giờ máy chủ). Rỗng = tính tất cả. */
  startDate: string
  /** % trên vốn ban đầu. 0 = không áp dụng. */
  targetPct: number
  dailyLossPct: number
  /** Giới hạn lỗ ngày tính trên vốn ban đầu, hay trên số dư đầu ngày. */
  dailyBase: 'initial' | 'dayStart'
  maxLossPct: number
  /** static: sàn cố định từ vốn ban đầu. trailing: sàn đi theo đỉnh số dư cuối ngày. */
  maxLossType: 'static' | 'trailing'
  minDays: number
}

type Rules = Omit<PropConfig, 'preset' | 'accountSize' | 'startDate'>

/**
 * Thông số tổng hợp từ các trang đánh giá bên thứ ba (11/2026), KHÔNG phải từ trang chính thức.
 * Các quỹ đổi luật thường xuyên; người dùng phải đối chiếu và sửa lại cho đúng tài khoản của mình.
 */
export const PRESETS: { id: string; name: string; rules: Rules }[] = [
  { id: 'ftmo-2s-1', name: 'FTMO 2-Step · Challenge', rules: { targetPct: 10, dailyLossPct: 5, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'static', minDays: 4 } },
  { id: 'ftmo-2s-2', name: 'FTMO 2-Step · Verification', rules: { targetPct: 5, dailyLossPct: 5, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'static', minDays: 4 } },
  { id: 'ftmo-1s', name: 'FTMO 1-Step', rules: { targetPct: 10, dailyLossPct: 3, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'trailing', minDays: 0 } },
  { id: '5ers-hs-1', name: 'The5ers High Stakes · Bước 1', rules: { targetPct: 8, dailyLossPct: 5, dailyBase: 'dayStart', maxLossPct: 10, maxLossType: 'static', minDays: 3 } },
  { id: '5ers-hs-2', name: 'The5ers High Stakes · Bước 2', rules: { targetPct: 5, dailyLossPct: 5, dailyBase: 'dayStart', maxLossPct: 10, maxLossType: 'static', minDays: 3 } },
  { id: '5ers-hg', name: 'The5ers Hyper Growth', rules: { targetPct: 10, dailyLossPct: 3, dailyBase: 'dayStart', maxLossPct: 6, maxLossType: 'static', minDays: 0 } },
  { id: '5ers-bc', name: 'The5ers Bootcamp (mỗi bước)', rules: { targetPct: 6, dailyLossPct: 0, dailyBase: 'dayStart', maxLossPct: 5, maxLossType: 'static', minDays: 0 } },
  { id: 'ten-express', name: 'TenTrade TenExpress', rules: { targetPct: 10, dailyLossPct: 6, dailyBase: 'initial', maxLossPct: 9, maxLossType: 'static', minDays: 5 } },
]

export const DEFAULT_PROP: PropConfig = { preset: PRESETS[0].id, accountSize: 100000, startDate: '', ...PRESETS[0].rules }

export interface PropDay {
  date: string
  net: number
  startBalance: number
  endBalance: number
  trades: number
  /** Số tiền được phép lỗ trong ngày (0 = không giới hạn). */
  dailyLimit: number
  dailyBreach: boolean
  /** Sàn số dư áp dụng trong ngày. */
  floor: number
  floorBreach: boolean
}

export interface PropStatus {
  balance: number
  pnl: number
  target: number
  targetProgress: number
  days: PropDay[]
  today: string
  todayNet: number
  dailyLimit: number
  dailyUsed: number
  dailyRemaining: number
  floor: number
  maxLossLimit: number
  maxLossUsed: number
  totalRemaining: number
  /** Số tiền còn được lỗ trước khi chạm giới hạn gần nhất. */
  room: number
  tradingDays: number
  daysLeftToMin: number
  breaches: string[]
  state: 'failed' | 'passed' | 'active'
}

export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Đánh giá theo LỆNH ĐÃ ĐÓNG, gom theo ngày máy chủ. Không thấy lãi/lỗ đang treo trong ngày,
 * nên có thể bỏ sót vi phạm xảy ra giữa phiên rồi hồi lại. `nowServer` là giờ máy chủ hiện tại.
 */
export function evaluateProp(trades: Trade[], cfg: PropConfig, nowServer: number): PropStatus {
  const size = cfg.accountSize
  const from = cfg.startDate ? Date.parse(cfg.startDate + 'T00:00:00Z') : -Infinity
  const used = trades.filter((t) => t.closeTime >= from).sort((a, b) => a.closeTime - b.closeTime)

  const byDay = new Map<string, { net: number; trades: number }>()
  const openDays = new Set<string>()
  for (const t of used) {
    const k = dayKey(t.closeTime)
    const d = byDay.get(k) ?? { net: 0, trades: 0 }
    d.net += netOf(t)
    d.trades++
    byDay.set(k, d)
    openDays.add(dayKey(t.openTime))
  }

  const maxLossLimit = (size * cfg.maxLossPct) / 100
  const limitFor = (startBalance: number) => ((cfg.dailyBase === 'initial' ? size : startBalance) * cfg.dailyLossPct) / 100
  const floorFor = (peak: number) => (cfg.maxLossType === 'trailing' ? peak : size) - maxLossLimit

  let balance = size
  let peak = size
  const days: PropDay[] = []
  const breaches: string[] = []
  for (const date of [...byDay.keys()].sort()) {
    const d = byDay.get(date)!
    const startBalance = balance
    const dailyLimit = limitFor(startBalance)
    const floor = floorFor(peak)
    balance += d.net
    const dailyBreach = dailyLimit > 0 && -d.net >= dailyLimit
    const floorBreach = maxLossLimit > 0 && balance <= floor
    if (dailyBreach) breaches.push(`${date}: lỗ trong ngày vượt giới hạn`)
    if (floorBreach) breaches.push(`${date}: số dư chạm mức lỗ tối đa`)
    days.push({ date, net: d.net, startBalance, endBalance: balance, trades: d.trades, dailyLimit, dailyBreach, floor, floorBreach })
    peak = Math.max(peak, balance)
  }

  const today = dayKey(nowServer)
  const todayRow = days.find((d) => d.date === today)
  const todayNet = todayRow?.net ?? 0
  const dailyLimit = limitFor(todayRow?.startBalance ?? balance)
  const dailyUsed = Math.max(0, -todayNet)
  const dailyRemaining = dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : Infinity
  // Trong ngày, sàn trailing vẫn theo đỉnh cuối ngày hôm trước.
  const floor = floorFor(todayRow ? Math.max(size, ...days.filter((d) => d.date < today).map((d) => d.endBalance)) : peak)
  const totalRemaining = maxLossLimit > 0 ? Math.max(0, balance - floor) : Infinity
  const pnl = balance - size
  const target = (size * cfg.targetPct) / 100
  const tradingDays = openDays.size
  const daysLeftToMin = Math.max(0, cfg.minDays - tradingDays)
  const state = breaches.length ? 'failed' : target > 0 && pnl >= target && daysLeftToMin === 0 ? 'passed' : 'active'

  return {
    balance, pnl, target,
    targetProgress: target > 0 ? Math.max(0, Math.min(1, pnl / target)) : 0,
    days, today, todayNet, dailyLimit, dailyUsed, dailyRemaining,
    floor, maxLossLimit,
    maxLossUsed: maxLossLimit > 0 ? Math.max(0, maxLossLimit - totalRemaining) : 0,
    totalRemaining,
    room: Math.min(dailyRemaining, totalRemaining),
    tradingDays, daysLeftToMin, breaches, state,
  }
}
