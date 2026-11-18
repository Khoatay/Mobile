/** Kiểu dữ liệu của phần tự động hoá trong bridge (bảo vệ tài khoản, cảnh báo, copy lệnh). */
export interface GuardConfig {
  enabled: boolean
  /** Số tiền được lỗ trong ngày (đã chốt + đang treo). 0 = không áp dụng. */
  daily_limit: number
  /** Mức equity không được chạm (sàn lỗ tổng). 0 = không áp dụng. */
  floor: number
  /** Tổng khoảng lỗ cho phép, để tính % đã dùng của sàn. */
  max_loss: number
  warn_at: number[]
  act_at: number
  max_consec_losses: number
  max_trades: number
  close_on_breach: boolean
  close_new_when_locked: boolean
  server_offset: number
  /** Gắn/siết SL khẩn cấp trên sàn. */
  hard_stop: boolean
  /** Khoá vì chạm giới hạn không mở tay được; khoá vì hành vi phải chờ 30 phút. */
  hard_lock: boolean
  /** Mốc tính lỗ ngày: số dư đầu ngày, hoặc số cao hơn giữa số dư và equity đầu ngày. */
  day_ref: 'balance' | 'higher'
  /** Chốt lãi ngày: lãi trong ngày chạm mức này thì đóng hết lệnh và khoá tới hết ngày. 0 = tắt. */
  profit_limit?: number
}
export interface GuardStops { on: boolean; protected: number; over: string[]; budget: number; at: number }
export interface GuardState {
  day_loss: number; used: number; floor_used: number; level: number; equity: number; currency: string
  consec_losses: number; trades: number; positions: number; tradable: boolean; error: string; updated: number
  stops?: GuardStops; day_ref?: number; ref_ok?: boolean
  day_profit?: number; profit_used?: number
}
export interface AutoEvent { at: number; kind: 'warn' | 'lock' | 'unlock' | 'news' | 'copy' | 'copy-error' | 'stop'; account: string; label: string; text: string }
export interface CopyFollower { account: string; mode: 'fixed' | 'multiplier' | 'balance'; value: number; reverse: boolean }
export interface CopierConfig { enabled: boolean; master: string; followers: CopyFollower[]; copy_sltp: boolean }
export interface DayRule { day: number; set_loss: boolean; set_profit: boolean; active: boolean; active_at: number; continued: boolean; protect: number | null; continued_from: number }
export interface AutomationSnapshot {
  guards: Record<string, GuardConfig>
  states: Record<string, GuardState>
  locks: Record<string, { until: number; reason: string; at: number; unlock_at?: number; kind?: 'limit' | 'behavior' | 'profit' }>
  /** Luật trong ngày (bridge giữ): đã đặt giới hạn hôm nay chưa, đã có lệnh chưa, đã trade tiếp sau chốt lời chưa. */
  rules?: Record<string, DayRule>
  events: AutoEvent[]
  alerts: { news: boolean; minutes: number; notify: boolean }
  copier: CopierConfig
  copyState: { started: number; last: number; error: string }
  telegram: boolean
}

/** Cách IB/trader đặt giới hạn trên app; app tính ra số tiền cụ thể rồi gửi cho bridge. */
export interface GuardUi {
  enabled: boolean
  /** prop: lấy từ luật quỹ; custom: % số dư tự đặt (quỹ); simple: tài khoản Real, chỉ đặt dừng lỗ và chốt lãi trong ngày. */
  source: 'prop' | 'custom' | 'simple'
  /** Tài khoản Real: dừng khi lỗ / lãi trong ngày, theo % số dư hoặc số tiền. 0 = tắt. */
  lossMode: 'pct' | 'money'
  lossValue: number
  profitMode: 'pct' | 'money'
  profitValue: number
  dailyPct: number
  totalPct: number
  warn1: number
  warn2: number
  actAt: number
  maxConsec: number
  maxTrades: number
  closeOnBreach: boolean
  closeNew: boolean
  hardStop: boolean
  hardLock: boolean
  /** Chỉ dùng khi tự đặt; theo luật quỹ thì lấy theo quỹ. */
  dayRef: 'balance' | 'higher'
}
export const DEFAULT_GUARD_UI: GuardUi = { lossMode: 'pct', lossValue: 3, profitMode: 'pct', profitValue: 0, enabled: true, source: 'prop', dailyPct: 3, totalPct: 8, warn1: 70, warn2: 90, actAt: 95, maxConsec: 3, maxTrades: 0, closeOnBreach: true, closeNew: true, hardStop: true, hardLock: true, dayRef: 'balance' }

/** Tính cấu hình gửi bridge. Với nguồn "prop", giới hạn lấy từ luật quỹ đã đánh giá (số tiền cụ thể của hôm nay). */
/** Số tiền của một mức đặt theo % số dư hoặc theo tiền. */
export const amountOf = (mode: 'pct' | 'money', value: number, balance: number) => round2(!(value > 0) ? 0 : mode === 'pct' ? (balance * value) / 100 : value)

export function buildGuard(ui: GuardUi, serverOffset: number, balance: number, prop?: PropLimits): GuardConfig {
  const u = { ...DEFAULT_GUARD_UI, ...ui }
  if (u.source === 'simple') {
    // Tài khoản Real: chỉ dừng lỗ và chốt lãi trong ngày. Chạm là đóng hết lệnh và khoá tới hết ngày; cảnh báo ở 70% và 90% mức lỗ.
    return {
      enabled: u.enabled, daily_limit: amountOf(u.lossMode, u.lossValue, balance), floor: 0, max_loss: 0,
      profit_limit: amountOf(u.profitMode, u.profitValue, balance),
      warn_at: [0.7, 0.9], act_at: 1, max_consec_losses: 0, max_trades: 0, close_on_breach: true, close_new_when_locked: true,
      server_offset: serverOffset, hard_stop: u.hardStop, hard_lock: u.hardLock, day_ref: 'balance',
    }
  }
  const fromProp = u.source === 'prop' && prop
  return {
    enabled: ui.enabled,
    daily_limit: round2(fromProp ? prop.dailyLimit : (balance * ui.dailyPct) / 100),
    floor: round2(fromProp ? prop.floor : ui.totalPct > 0 ? balance * (1 - ui.totalPct / 100) : 0),
    max_loss: round2(fromProp ? prop.maxLossLimit : (balance * ui.totalPct) / 100),
    warn_at: [ui.warn1, ui.warn2].filter((x) => x > 0 && x < ui.actAt).map((x) => x / 100),
    act_at: ui.actAt / 100,
    max_consec_losses: ui.maxConsec,
    max_trades: ui.maxTrades,
    close_on_breach: ui.closeOnBreach,
    close_new_when_locked: ui.closeNew,
    server_offset: serverOffset,
    hard_stop: u.hardStop,
    hard_lock: u.hardLock,
    day_ref: fromProp ? prop.dayRef ?? 'balance' : u.dayRef,
  }
}
export interface PropLimits { dailyLimit: number; floor: number; maxLossLimit: number; dayRef?: 'balance' | 'higher' }
/** Quỹ tính lỗ ngày từ số cao hơn giữa số dư và equity đầu ngày (giữ lệnh lãi qua đêm rồi mất lãi cũng tính là lỗ). */
export const dayRefOfPreset = (preset: string): 'balance' | 'higher' => (preset.startsWith('5ers') ? 'higher' : 'balance')
const round2 = (v: number) => Math.round(v * 100) / 100

/** Hai cấu hình khác nhau đủ để phải gửi lại (bỏ qua chênh lệch nhỏ hơn 1 xu). */
export function guardChanged(a: GuardConfig | undefined, b: GuardConfig): boolean {
  if (!a) return true
  return (Object.keys(b) as (keyof GuardConfig)[]).some((k) => {
    const x = a[k], y = b[k]
    if (typeof y === 'number') return Math.abs((x as number) - y) >= 0.01
    return JSON.stringify(x) !== JSON.stringify(y)
  })
}

/** Khối lượng lệnh chép, giống bridge, để xem trước trên giao diện. */
export function copyVolume(masterVol: number, masterBalance: number, followerBalance: number, f: CopyFollower): number {
  if (f.mode === 'fixed') return f.value
  if (f.mode === 'balance') return masterVol * (masterBalance > 0 ? followerBalance / masterBalance : 0) * f.value
  return masterVol * f.value
}
