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
  /** Luật nhất quán: lãi của ngày tốt nhất không vượt quá X% tổng lãi. 0 = không áp dụng. */
  consistencyPct: number
  /** Cấm mở/đóng lệnh trong X phút trước và sau tin mạnh của đồng tiền liên quan. 0 = không áp dụng. */
  newsWindowMin: number
  /** Cấm giữ lệnh qua cuối tuần. */
  noWeekend: boolean
  /** Tài khoản đã cấp vốn: % lợi nhuận bạn nhận, chu kỳ rút (ngày), trần mỗi lần rút (% vốn, 0 = không trần). */
  profitSplitPct: number
  payoutDays: number
  payoutCapPct: number
  /** Ngày rút gần nhất (yyyy-mm-dd). Rỗng = chưa rút lần nào, tính từ ngày bắt đầu. */
  lastPayout: string
}

type Rules = Omit<PropConfig, 'preset' | 'accountSize' | 'startDate' | 'lastPayout'>

/** Giá trị mặc định cho các luật thêm sau; cấu hình đã lưu từ bản cũ được gộp với cái này. */
export const EXTRA_DEFAULTS = { consistencyPct: 0, newsWindowMin: 0, noWeekend: false, profitSplitPct: 0, payoutDays: 0, payoutCapPct: 0, lastPayout: '' }
export const withDefaults = (c: Partial<PropConfig> & Pick<PropConfig, 'preset' | 'accountSize'>): PropConfig => ({ ...DEFAULT_PROP, ...EXTRA_DEFAULTS, ...c })

/**
 * Thông số tổng hợp từ các trang đánh giá bên thứ ba (11/2026), KHÔNG phải từ trang chính thức.
 * Các quỹ đổi luật thường xuyên; người dùng phải đối chiếu và sửa lại cho đúng tài khoản của mình.
 */
const R = (r: Partial<Rules> & Pick<Rules, 'targetPct' | 'dailyLossPct' | 'dailyBase' | 'maxLossPct' | 'maxLossType' | 'minDays'>): Rules => ({ ...EXTRA_DEFAULTS, ...r })

/**
 * Luật nhất quán, cấm tin, cấm giữ cuối tuần và chia lợi nhuận chỉ điền khi có nguồn; để 0/tắt nghĩa là chưa rõ, người dùng tự bật theo điều khoản.
 * TenTrade: 10% mục tiêu cho Challenge, Instant không có mục tiêu; giới hạn lỗ theo cỡ tài khoản (lỗ ngày 6% ở tài khoản nhỏ, 3% ở tài khoản lớn;
 * lỗ tổng 9% xuống 5–7%); chia 70%, rút mỗi 15 ngày; TenExpress giới hạn 25% lãi mỗi ngày/lệnh và trần 10% mỗi lần rút. FundedNext: Stellar 2-Step 8%/5%, 5% ngày, 10% tổng;
 * Stellar 1-Step 10%, 3% ngày, 6% tổng; không có luật nhất quán.
 */
export const PRESETS: { id: string; name: string; rules: Rules }[] = [
  // FTMO: đọc từ trang chọn gói trader.ftmo.com (18/11/2026). Lỗ ngày và lỗ tổng tính trên vốn ban đầu.
  // Trang ghi thêm "thời gian giao dịch 14 ngày"; app chưa đếm hạn này. Mục tiêu bước 1 của gói 2 bước chưa thấy trên ảnh: giữ 10%, cần đối chiếu.
  { id: 'ftmo-2s-1', name: 'FTMO 2-Step · Challenge', rules: R({ targetPct: 10, dailyLossPct: 5, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'static', minDays: 2 }) },
  { id: 'ftmo-2s-2', name: 'FTMO 2-Step · Verification', rules: R({ targetPct: 5, dailyLossPct: 5, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'static', minDays: 2 }) },
  { id: 'ftmo-1s', name: 'FTMO 1-Step', rules: R({ targetPct: 5, dailyLossPct: 3, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'trailing', minDays: 0, consistencyPct: 50 }) },
  // Instant: sàn lỗ tổng bám theo đỉnh trong ngày; app đang tính theo đỉnh số dư cuối ngày nên có thể chậm hơn quỹ một chút.
  { id: 'ftmo-instant', name: 'FTMO Instant (không có mục tiêu)', rules: R({ targetPct: 0, dailyLossPct: 3, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'trailing', minDays: 0, consistencyPct: 30 }) },
  { id: 'ftmo-funded', name: 'FTMO Account (đã cấp vốn)', rules: R({ targetPct: 0, dailyLossPct: 5, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'static', minDays: 0, profitSplitPct: 80, payoutDays: 14 }) },
  // The5ers: đọc từ trang mua gói hub.the5ers.com (18/11/2026). Lỗ ngày tính từ số cao hơn giữa số dư và equity đầu ngày.
  // Số ngày giao dịch tối thiểu không hiện trên trang mua gói: giữ số cũ, cần đối chiếu.
  { id: '5ers-hs-1', name: 'The5ers High Stakes Classic · Bước 1', rules: R({ targetPct: 8, dailyLossPct: 4, dailyBase: 'dayStart', maxLossPct: 8, maxLossType: 'static', minDays: 3 }) },
  { id: '5ers-hs-2', name: 'The5ers High Stakes Classic · Bước 2', rules: R({ targetPct: 5, dailyLossPct: 4, dailyBase: 'dayStart', maxLossPct: 8, maxLossType: 'static', minDays: 3 }) },
  { id: '5ers-hs-f', name: 'The5ers High Stakes Classic · Đã cấp vốn', rules: R({ targetPct: 10, dailyLossPct: 4, dailyBase: 'dayStart', maxLossPct: 8, maxLossType: 'static', minDays: 0 }) },
  { id: '5ers-hsn-1', name: 'The5ers High Stakes (gói mới) · Bước 1', rules: R({ targetPct: 10, dailyLossPct: 3, dailyBase: 'dayStart', maxLossPct: 10, maxLossType: 'static', minDays: 3 }) },
  { id: '5ers-hsn-2', name: 'The5ers High Stakes (gói mới) · Bước 2', rules: R({ targetPct: 5, dailyLossPct: 3, dailyBase: 'dayStart', maxLossPct: 10, maxLossType: 'static', minDays: 3 }) },
  { id: '5ers-hsn-f', name: 'The5ers High Stakes (gói mới) · Đã cấp vốn', rules: R({ targetPct: 10, dailyLossPct: 3, dailyBase: 'dayStart', maxLossPct: 10, maxLossType: 'static', minDays: 0, consistencyPct: 50 }) },
  { id: '5ers-hg', name: 'The5ers Growth (1 bước)', rules: R({ targetPct: 10, dailyLossPct: 3, dailyBase: 'dayStart', maxLossPct: 6, maxLossType: 'static', minDays: 0 }) },
  { id: '5ers-hg-c', name: 'The5ers Growth (1 bước, gói có luật nhất quán 50%)', rules: R({ targetPct: 10, dailyLossPct: 3, dailyBase: 'dayStart', maxLossPct: 6, maxLossType: 'static', minDays: 0, consistencyPct: 50 }) },
  { id: '5ers-bc', name: 'The5ers Bootcamp (mỗi bước, không giới hạn lỗ ngày)', rules: R({ targetPct: 6, dailyLossPct: 0, dailyBase: 'dayStart', maxLossPct: 5, maxLossType: 'static', minDays: 0 }) },
  { id: '5ers-bc-f', name: 'The5ers Bootcamp · Đã cấp vốn', rules: R({ targetPct: 5, dailyLossPct: 0, dailyBase: 'dayStart', maxLossPct: 4, maxLossType: 'static', minDays: 0 }) },
  { id: 'ten-express', name: 'TenTrade TenExpress Challenge (tài khoản nhỏ)', rules: R({ targetPct: 10, dailyLossPct: 6, dailyBase: 'initial', maxLossPct: 9, maxLossType: 'static', minDays: 5, consistencyPct: 25, profitSplitPct: 70, payoutDays: 15, payoutCapPct: 10 }) },
  { id: 'ten-express-l', name: 'TenTrade TenExpress Challenge (tài khoản lớn)', rules: R({ targetPct: 10, dailyLossPct: 3, dailyBase: 'initial', maxLossPct: 5, maxLossType: 'static', minDays: 5, consistencyPct: 25, profitSplitPct: 70, payoutDays: 15, payoutCapPct: 10 }) },
  { id: 'ten-express-i', name: 'TenTrade TenExpress Instant', rules: R({ targetPct: 0, dailyLossPct: 6, dailyBase: 'initial', maxLossPct: 9, maxLossType: 'static', minDays: 0, consistencyPct: 25, profitSplitPct: 70, payoutDays: 15, payoutCapPct: 10 }) },
  { id: 'ten-edge', name: 'TenTrade TenEdge Challenge', rules: R({ targetPct: 10, dailyLossPct: 6, dailyBase: 'initial', maxLossPct: 9, maxLossType: 'static', minDays: 5, profitSplitPct: 70, payoutDays: 15 }) },
  { id: 'ten-edge-i', name: 'TenTrade TenEdge Instant', rules: R({ targetPct: 0, dailyLossPct: 6, dailyBase: 'initial', maxLossPct: 9, maxLossType: 'static', minDays: 0, profitSplitPct: 70, payoutDays: 15 }) },
  { id: 'fn-2s-1', name: 'FundedNext Stellar 2-Step · Bước 1', rules: R({ targetPct: 8, dailyLossPct: 5, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'static', minDays: 5 }) },
  { id: 'fn-2s-2', name: 'FundedNext Stellar 2-Step · Bước 2', rules: R({ targetPct: 5, dailyLossPct: 5, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'static', minDays: 5 }) },
  { id: 'fn-1s', name: 'FundedNext Stellar 1-Step', rules: R({ targetPct: 10, dailyLossPct: 3, dailyBase: 'initial', maxLossPct: 6, maxLossType: 'static', minDays: 2 }) },
]

/** Ngày cập nhật bộ luật mẫu, hiện cạnh lời nhắc đối chiếu điều khoản. */
export const PRESETS_UPDATED = '11/2026'

export const DEFAULT_PROP: PropConfig = { preset: PRESETS[0].id, accountSize: 100000, startDate: '', lastPayout: '', ...PRESETS[0].rules }

const SIZES = [5000, 10000, 15000, 25000, 50000, 100000, 200000, 400000]

/**
 * Bộ luật ban đầu cho một tài khoản quỹ, đoán từ tên broker và giai đoạn ("Vòng 2" -> bước 2),
 * và cỡ tài khoản chuẩn gần nhất với số dư hiện tại (nếu lệch không quá 15%). Người dùng sửa lại được.
 */
export function suggestProp(broker: string, phase: string, balance?: number): PropConfig {
  const b = broker.toLowerCase().replace(/\s/g, '')
  const second = /2|verification|xác minh/i.test(phase)
  const id = b.includes('ftmo') ? (/instant/i.test(phase) ? 'ftmo-instant' : /1.?step|1 bước/i.test(phase) ? 'ftmo-1s' : second ? 'ftmo-2s-2' : 'ftmo-2s-1')
    : b.includes('5ers') ? (second ? '5ers-hs-2' : '5ers-hs-1')
    : b.includes('tentrade') ? (/instant/i.test(phase) ? 'ten-express-i' : 'ten-express')
    : b.includes('fundednext') ? (second ? 'fn-2s-2' : 'fn-2s-1')
    : PRESETS[0].id
  const preset = PRESETS.find((p) => p.id === id)!
  const near = balance ? SIZES.reduce((a, c) => (Math.abs(c - balance) < Math.abs(a - balance) ? c : a)) : 0
  const accountSize = near && Math.abs(near - balance!) / near <= 0.15 ? near : DEFAULT_PROP.accountSize
  return { preset: preset.id, accountSize, startDate: '', lastPayout: '', ...preset.rules }
}

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
 * `floating` là lãi/lỗ đang treo đọc trực tiếp từ MT5 (nếu có), được cộng vào lỗ hôm nay và lỗ tổng.
 */
export function evaluateProp(trades: Trade[], cfg: PropConfig, nowServer: number, floating = 0): PropStatus {
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
  const dailyUsed = Math.max(0, -(todayNet + floating))
  const dailyRemaining = dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : Infinity
  // Trong ngày, sàn trailing vẫn theo đỉnh cuối ngày hôm trước.
  const floor = floorFor(todayRow ? Math.max(size, ...days.filter((d) => d.date < today).map((d) => d.endBalance)) : peak)
  const totalRemaining = maxLossLimit > 0 ? Math.max(0, balance + floating - floor) : Infinity
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
