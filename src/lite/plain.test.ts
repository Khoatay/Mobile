import { describe, expect, it } from 'vitest'
import type { Trade } from '../lib/types'
import { periodStarts, pnlSince, priceMove, riskTone, slPresets, verdict } from './plain'

const t = (closeTime: number, profit: number): Trade => ({
  id: String(closeTime), ticket: '', symbol: 'EURUSD', side: 'buy', volume: 0.1, openTime: closeTime - 1, closeTime,
  openPrice: 1, closePrice: 1, sl: 0, tp: 0, commission: -1, swap: 0, profit, source: 'manual',
})

describe('bản đơn giản', () => {
  it('đổi pip sang khoảng giá', () => {
    expect(priceMove('XAUUSD', 50)).toBe('5.0')
    expect(priceMove('EURUSD', 20)).toBe('0.0020')
    expect(priceMove('USDJPY', 15)).toBe('0.15')
    expect(priceMove('EURUSD', 0)).toBe('')
  })

  it('gợi ý stop loss rộng hơn cho vàng', () => {
    expect(slPresets('XAUUSD')[1].pips).toBeGreaterThan(slPresets('EURUSD')[1].pips)
  })

  it('xếp mức rủi ro', () => {
    expect(riskTone(1)).toBe('ok')
    expect(riskTone(2.5)).toBe('high')
    expect(riskTone(5)).toBe('danger')
  })

  it('tính mốc ngày và tuần theo giờ máy chủ', () => {
    // Thứ 4, 18/11/2026 23:00 UTC → đã sang thứ 5 ở máy chủ UTC+2.
    const now = Date.UTC(2026, 10, 18, 23)
    const { day, week } = periodStarts(now, 2)
    expect(day).toBe(Date.UTC(2026, 10, 19))
    expect(week).toBe(Date.UTC(2026, 10, 16))
  })

  it('cộng lãi/lỗ từ một mốc, đã trừ phí', () => {
    const r = pnlSince([t(10, 50), t(20, -30), t(5, 100)], 10)
    expect(r).toEqual({ net: 18, n: 2 })
  })

  it('nhận xét không kết luận khi quá ít lệnh', () => {
    expect(verdict({ n: 5, net: 100, winRate: 1, avgWin: 20, avgLoss: 0 })).toMatch(/quá ít/)
    expect(verdict({ n: 40, net: -100, winRate: 0.6, avgWin: 10, avgLoss: 30 })).toMatch(/lệnh thua đang quá lớn/)
  })
})
