import { describe, expect, it } from 'vitest'
import { DEFAULT_PROP, evaluateProp, PRESETS, type PropConfig } from './prop'
import type { Trade } from './types'

const mk = (day: number, profit: number, hour = 10): Trade => ({
  id: `t${day}-${hour}-${profit}`, ticket: '1', symbol: 'EURUSD', side: 'buy', volume: 1,
  openTime: Date.UTC(2026, 0, day, hour), closeTime: Date.UTC(2026, 0, day, hour + 1),
  openPrice: 1, closePrice: 1, sl: 0, tp: 0, commission: 0, swap: 0, profit, source: 'manual',
})
const cfg: PropConfig = { ...DEFAULT_PROP, accountSize: 100000 } // FTMO 2-Step: 10 / 5 / 10, 4 ngày
const now = Date.UTC(2026, 0, 9, 12)

describe('evaluateProp', () => {
  it('đang chạy: tiến độ và khoảng lỗ còn lại', () => {
    const s = evaluateProp([mk(5, 2000), mk(6, -1000), mk(9, -1500), mk(9, 500, 12)], cfg, now)
    expect(s.balance).toBe(100000)
    expect(s.state).toBe('active')
    expect(s.todayNet).toBe(-1000)
    expect(s.dailyLimit).toBe(5000)
    expect(s.dailyRemaining).toBe(4000)
    expect(s.floor).toBe(90000)
    expect(s.totalRemaining).toBe(10000)
    expect(s.room).toBe(4000)
    expect(s.tradingDays).toBe(3)
    expect(s.daysLeftToMin).toBe(1)
  })
  it('hôm nay chưa có lệnh: còn nguyên giới hạn ngày', () => {
    const s = evaluateProp([mk(5, -3000)], cfg, now)
    expect(s.dailyUsed).toBe(0)
    expect(s.dailyRemaining).toBe(5000)
    expect(s.totalRemaining).toBe(7000)
  })
  it('lãi/lỗ đang treo từ MT5 được tính vào cả hai giới hạn', () => {
    const s = evaluateProp([mk(5, -3000), mk(9, -1000)], cfg, now, -1500)
    expect(s.dailyUsed).toBe(2500)
    expect(s.dailyRemaining).toBe(2500)
    expect(s.totalRemaining).toBe(4500)
  })
  it('vi phạm lỗ ngày', () => {
    const s = evaluateProp([mk(5, -3000), mk(5, -2000, 14)], cfg, now)
    expect(s.state).toBe('failed')
    expect(s.days[0].dailyBreach).toBe(true)
  })
  it('vi phạm lỗ tổng dù không ngày nào vượt giới hạn ngày', () => {
    const s = evaluateProp([mk(5, -4000), mk(6, -4000), mk(7, -2000)], cfg, now)
    expect(s.days.map((d) => d.dailyBreach)).toEqual([false, false, false])
    expect(s.days[2].floorBreach).toBe(true)
    expect(s.state).toBe('failed')
  })
  it('đạt mục tiêu nhưng chưa đủ ngày thì chưa qua', () => {
    expect(evaluateProp([mk(5, 10000)], cfg, now).state).toBe('active')
    expect(evaluateProp([mk(5, 4000), mk(6, 3000), mk(7, 2000), mk(8, 1000)], cfg, now).state).toBe('passed')
  })
  it('sàn trailing đi theo đỉnh số dư cuối ngày', () => {
    const c = { ...cfg, ...PRESETS.find((p) => p.id === 'ftmo-1s')!.rules }
    const s = evaluateProp([mk(5, 6000), mk(6, -2000)], c, now)
    expect(s.floor).toBe(96000)
    expect(s.totalRemaining).toBe(8000)
    expect(s.dailyLimit).toBe(3000)
  })
  it('giới hạn ngày theo số dư đầu ngày', () => {
    const c = { ...cfg, ...PRESETS.find((p) => p.id === '5ers-hs-1')!.rules }
    const s = evaluateProp([mk(5, 8000 - 1), mk(9, -100)], c, now)
    expect(s.dailyLimit).toBeCloseTo(107999 * 0.05)
  })
  it('không có giới hạn ngày (Bootcamp) và ngày bắt đầu', () => {
    const c = { ...cfg, ...PRESETS.find((p) => p.id === '5ers-bc')!.rules, startDate: '2026-01-06' }
    const s = evaluateProp([mk(5, -4900), mk(6, -4000)], c, now)
    expect(s.days).toHaveLength(1)
    expect(s.dailyRemaining).toBe(Infinity)
    expect(s.room).toBe(1000)
    expect(s.state).toBe('active')
  })
})
