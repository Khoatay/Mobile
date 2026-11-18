import { describe, expect, it } from 'vitest'
import { summarize, type Challenge } from './challenges'
import { SAMPLE_QUOTES } from './forex'
import type { CalEvent } from './news'
import { DEFAULT_PROP, evaluateProp, PRESETS, withDefaults, type PropConfig, type PropDay } from './prop'
import { consistency, heldOverWeekend, maxLotForRoom, nearWeekend, newsViolations, payout, upcomingNews } from './propRules'
import { MIN_SIM_TRADES, riskLevels, simInput, simulate } from './propSim'
import type { Trade } from './types'

const H = 3_600_000, DAY = 24 * H
const t = (open: number, close: number, o: Partial<Trade> = {}): Trade => ({
  id: String(open), ticket: '', symbol: 'EURUSD', side: 'buy', volume: 0.1, openTime: open, closeTime: close,
  openPrice: 1.1, closePrice: 1.1, sl: 0, tp: 0, commission: 0, swap: 0, profit: 0, source: 'mt5', ...o,
})
const day = (date: string, net: number): PropDay => ({ date, net, startBalance: 0, endBalance: 0, trades: 1, dailyLimit: 0, dailyBreach: false, floor: 0, floorBreach: false })

describe('luật quỹ bổ sung', () => {
  it('lot tối đa để chạm SL vẫn chưa hết khoảng còn được lỗ', () => {
    // Còn 500 USD, SL 50 pip vàng (10 USD/pip/lot) → 1.00 lot.
    expect(maxLotForRoom(500, 'XAUUSD', 50, 'USD', SAMPLE_QUOTES)).toBe(1)
    expect(maxLotForRoom(0, 'XAUUSD', 50, 'USD', SAMPLE_QUOTES)).toBeNull()
    expect(maxLotForRoom(Infinity, 'EURUSD', 20, 'USD', SAMPLE_QUOTES)).toBeNull()
  })

  it('luật nhất quán: ngày tốt nhất so với tổng lãi', () => {
    const c = consistency([day('d1', 600), day('d2', 200), day('d3', 200)], 40)!
    expect(c.share).toBeCloseTo(0.6)
    expect(c.ok).toBe(false)
    // Cần tổng lãi 1500 để 600 còn 40%: thêm 500.
    expect(c.needMore).toBeCloseTo(500)
    expect(consistency([day('d1', 300), day('d2', 300), day('d3', 400)], 40)!.ok).toBe(true)
    expect(consistency([day('d1', 300)], 0)).toBeNull()
  })

  it('nhận ra lệnh giữ qua cuối tuần', () => {
    const fri = Date.UTC(2026, 10, 20, 20) // thứ Sáu 20:00
    const mon = Date.UTC(2026, 10, 23, 2)
    expect(heldOverWeekend([t(fri, mon)]).length).toBe(1)
    expect(heldOverWeekend([t(fri, fri + H)]).length).toBe(0)
    expect(nearWeekend(fri).near).toBe(true)
    expect(nearWeekend(Date.UTC(2026, 10, 18, 20)).near).toBe(false)
  })

  it('lệnh mở/đóng sát tin mạnh của đồng tiền liên quan', () => {
    const ev: CalEvent = { title: 'Non-Farm Payrolls', currency: 'USD', date: '2026-11-06T13:30:00Z', impact: 'High', forecast: '', previous: '' }
    // Máy chủ UTC+2: tin lúc 15:30 giờ máy chủ.
    const at = Date.UTC(2026, 10, 6, 15, 30)
    const hits = newsViolations([t(at - 60_000, at + H, { symbol: 'XAUUSD' }), t(at - 2 * H, at - H), t(at - H, at + 90_000, { symbol: 'EURJPY' })], [ev], 2, 2)
    expect(hits.map((h) => `${h.trade!.symbol}:${h.what}`)).toEqual(['XAUUSD:open'])
    expect(newsViolations([t(at, at + H)], [ev], 0, 2)).toEqual([])
    expect(upcomingNews([ev], ['XAUUSD'], Date.parse(ev.date) - 30 * 60_000).length).toBe(1)
    expect(upcomingNews([ev], ['EURJPY'], Date.parse(ev.date) - 30 * 60_000).length).toBe(0)
  })

  it('rút lợi nhuận: chia %, trần mỗi lần rút, ngày rút tiếp theo', () => {
    const cfg = { accountSize: 100_000, profitSplitPct: 70, payoutDays: 15, payoutCapPct: 10, lastPayout: '2026-11-10', startDate: '' }
    const p = payout(cfg, 115_000, Date.UTC(2026, 10, 18))!
    expect(p.capped).toBe(true)
    expect(p.withdrawable).toBeCloseTo(7_000)
    expect(p.nextDate).toBe('2026-11-25')
    expect(p.daysToNext).toBe(7)
    expect(payout({ ...cfg, profitSplitPct: 0 }, 115_000, 0)).toBeNull()
  })

  it('cấu hình cũ được gộp với luật mới, bộ luật TenTrade và FundedNext có sẵn', () => {
    const old = { preset: 'ftmo-2s-1', accountSize: 100_000, startDate: '', targetPct: 10, dailyLossPct: 5, dailyBase: 'initial', maxLossPct: 10, maxLossType: 'static', minDays: 4 } as PropConfig
    expect(withDefaults(old).consistencyPct).toBe(0)
    expect(PRESETS.filter((p) => p.id.startsWith('ten-')).length).toBeGreaterThanOrEqual(4)
    expect(PRESETS.find((p) => p.id === 'ten-express')!.rules.consistencyPct).toBe(25)
    expect(PRESETS.find((p) => p.id === 'fn-1s')!.rules.maxLossPct).toBe(6)
  })
})

describe('mô phỏng khả năng qua vòng', () => {
  const make = (rs: number[]) => rs.map((r, i) => t(Date.UTC(2026, 9, 1) + Math.floor(i / 2) * DAY, Date.UTC(2026, 9, 1) + Math.floor(i / 2) * DAY + H, { sl: 1.09, closePrice: 1.1 + r * 0.01 }))
  const cfg = withDefaults({ ...DEFAULT_PROP, accountSize: 100_000 })
  const start = evaluateProp([], cfg, 0)

  it('chưa đủ lệnh thì không mô phỏng', () => {
    const r = simulate(simInput(make([1, -1])), cfg, start, 1)
    expect(r.open).toBe(1)
    expect(MIN_SIM_TRADES).toBe(20)
  })

  it('cách giao dịch có lợi thế thì khả năng qua cao, rủi ro lớn thì dễ rớt hơn', () => {
    // Thắng 50%, ăn 2R thua 1R.
    const input = simInput(make(Array.from({ length: 40 }, (_, i) => (i % 2 ? 2 : -1))))
    const low = simulate(input, cfg, start, 0.5)
    const high = simulate(input, cfg, start, 3)
    expect(low.pass).toBeGreaterThan(0.8)
    expect(high.fail).toBeGreaterThan(low.fail)
    expect(low.pass + low.fail + low.open).toBeCloseTo(1)
    // Cùng dữ liệu, cùng kết quả.
    expect(simulate(input, cfg, start, 0.5)).toEqual(low)
  })

  it('cách giao dịch thua lỗ thì gần như không qua', () => {
    const input = simInput(make(Array.from({ length: 40 }, (_, i) => (i % 3 ? -1 : 1))))
    expect(simulate(input, cfg, start, 1).pass).toBeLessThan(0.1)
    expect(riskLevels(0.8)).toEqual([0.25, 0.5, 0.8, 1, 1.5, 2])
  })
})

describe('lịch sử thi quỹ', () => {
  it('tổng hợp phí, tiền rút và tỷ lệ qua theo quỹ', () => {
    const c = (firm: string, status: Challenge['status'], fee: number, paid = 0): Challenge => ({ id: firm + status + fee, firm, program: '', size: 100_000, fee, date: '2026-01-01', status, payouts: paid ? [{ date: '2026-02-01', amount: paid }] : [], note: '' })
    const { firms, total } = summarize([c('FTMO', 'failed', 540), c('FTMO', 'funded', 540, 2_000), c('FTMO', 'active', 540), c('TenTrade', 'refunded', 300)])
    const ftmo = firms.find((f) => f.firm === 'FTMO')!
    expect(ftmo.passRate).toBe(0.5)
    expect(ftmo.fees).toBe(1_620)
    expect(ftmo.net).toBe(380)
    expect(total.fees).toBe(1_620)
    expect(firms.find((f) => f.firm === 'TenTrade')!.passRate).toBeNull()
  })
})
