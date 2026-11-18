import { describe, expect, it } from 'vitest'
import type { Trade } from './types'
import { assess, computeMetrics } from './traderScore'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 6, 1, 8)

/** Lệnh EURUSD buy: thắng thì +reward pip, thua thì −risk pip; lãi/lỗ theo 10 USD/pip/lot. */
function trade(i: number, o: { day: number; minute?: number; win: boolean; lot?: number; sl?: boolean; holdMin?: number; lossPips?: number }): Trade {
  const lot = o.lot ?? 0.1
  const open = T0 + o.day * DAY + (o.minute ?? 0) * 60_000
  const pips = o.win ? 30 : -(o.lossPips ?? 20)
  return {
    id: `t${i}`, ticket: String(i), symbol: 'EURUSD', side: 'buy', volume: lot,
    openTime: open, closeTime: open + (o.holdMin ?? 60) * 60_000,
    openPrice: 1.1, closePrice: 1.1 + pips * 0.0001, sl: o.sl === false ? 0 : 1.1 - 0.002, tp: 0,
    commission: 0, swap: 0, profit: pips * 10 * lot, source: 'mt5',
  }
}

describe('đánh giá tài khoản theo dõi', () => {
  it('tính thắng/thua lớn nhất, nhỏ nhất và trung bình', () => {
    const list = [trade(1, { day: 0, win: true }), trade(2, { day: 1, win: false }), trade(3, { day: 2, win: true, lot: 0.2 }), trade(4, { day: 3, win: false, lossPips: 10 })]
    const m = computeMetrics(list, 10_000)
    expect(m.bestWin).toBeCloseTo(60)
    expect(m.smallestWin).toBeCloseTo(30)
    expect(m.worstLoss).toBeCloseTo(20)
    expect(m.smallestLoss).toBeCloseTo(10)
    expect(m.avgWin).toBeCloseTo(45)
    expect(m.avgLoss).toBeCloseTo(15)
    expect(m.winRate).toBe(0.5)
  })

  it('người kỷ luật, có lãi đều: đáng cân nhắc theo', () => {
    // 70 lệnh trong ~100 ngày, thắng 55%, lot đều, luôn có SL, cắt lỗ nhanh.
    const list = Array.from({ length: 70 }, (_, i) => trade(i, { day: Math.floor(i * 1.45), win: i % 20 < 11, holdMin: i % 20 < 11 ? 120 : 45 }))
    const a = assess(list, 10_000)
    expect(a.safety.grade).toBe('good')
    expect(a.discipline.grade).toBe('good')
    expect(a.fomo.grade).toBe('good')
    expect(a.confidence).toBe('high')
    expect(a.verdict.level).toBe('consider')
  })

  it('gấp thếp sau khi thua và vào lệnh gỡ: không nên theo', () => {
    const list: Trade[] = []
    let lot = 0.1
    for (let i = 0; i < 60; i++) {
      const win = i % 3 === 2
      // lệnh tiếp theo mở 5 phút sau lệnh trước đóng
      list.push(trade(i, { day: Math.floor(i / 3), minute: (i % 3) * 65, win, lot, sl: false, holdMin: 60, lossPips: 40 }))
      lot = win ? 0.1 : Math.round(lot * 2 * 100) / 100
    }
    const a = assess(list, 5_000)
    expect(a.metrics.martingaleShare).toBeGreaterThan(0.9)
    expect(a.metrics.revengeShare).toBeGreaterThan(0.5)
    expect(a.safety.score).toBeLessThan(40)
    expect(a.fomo.grade).toBe('bad')
    expect(a.verdict.level).toBe('avoid')
  })

  it('vào lot thất thường cả sau thắng lẫn thua thì không bị coi là gấp thếp', () => {
    const lots = [0.1, 0.2, 0.1, 0.3, 0.1, 0.2]
    const list = Array.from({ length: 60 }, (_, i) => trade(i, { day: i, win: i % 2 === 0, lot: lots[i % lots.length] }))
    expect(computeMetrics(list, 10_000).martingaleShare).toBe(0)
  })

  it('quá ít lệnh thì chưa kết luận', () => {
    const a = assess([trade(1, { day: 0, win: true }), trade(2, { day: 1, win: true })], 10_000)
    expect(a.verdict.level).toBe('unknown')
    expect(a.confidence).toBe('low')
  })

  it('vốn là số dư trừ lãi/lỗ trong kỳ (đã gồm tiền nạp), nên toàn bộ lịch sử cũng tính đúng', () => {
    // Nạp 1.000 rồi nạp thêm 1.000, lãi 30: vốn 2.000, tăng 1.5%.
    const m = computeMetrics([trade(1, { day: 0, win: true })], 2_030)
    expect(m.startBalance).toBeCloseTo(2_000)
    expect(m.growthPct).toBeCloseTo(0.015)
  })
})
