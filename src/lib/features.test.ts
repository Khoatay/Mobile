import { describe, expect, it } from 'vitest'
import type { Candle } from './bridge'
import { atr, referenceLevels, swings, tfFeatures } from './features'

// Dựng nến từ dãy giá đóng cửa; thân nến đi từ giá trước sang giá sau, râu 0.1 mỗi phía.
const fromCloses = (closes: number[], step = 3600, t0 = 1_800_000_000): Candle[] =>
  closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: t0 + i * step, o, c, h: Math.max(o, c) + 0.1, l: Math.min(o, c) - 0.1 } })

describe('features', () => {
  it('ATR và đỉnh đáy fractal', () => {
    const c = fromCloses([10, 11, 12, 13, 12, 11, 10, 11, 12, 13, 14, 13, 12])
    expect(atr(c)).toBeCloseTo(1.2, 1)
    const s = swings(c, 2)
    expect(s.map((x) => [x.kind, x.price])).toEqual([['high', 13.1], ['low', 9.9], ['high', 14.1]])
  })

  it('cấu trúc tăng: HH/HL, BOS tăng, rồi CHoCH giảm khi phá đáy', () => {
    // sóng tăng: đáy 10 -> đỉnh 14 -> đáy 12 -> đỉnh 16 (phá 14) -> đáy 14 -> đỉnh 18, rồi sập dưới 14
    const up = [10, 11, 12, 13, 14, 13, 12.5, 12, 13, 14, 15, 16, 15, 14.5, 14, 15, 16, 17, 18, 17, 16, 15, 14, 13, 12]
    const f = tfFeatures('H1', fromCloses(up), 2, 2)
    const labels = f.swings.map((s) => `${s.kind}:${s.label}`)
    expect(labels).toContain('high:HH')
    expect(labels).toContain('low:HL')
    expect(f.breaks.map((b) => `${b.kind}-${b.dir}`)).toEqual(['BOS-up', 'BOS-up', 'CHoCH-down'])
    expect(f.breaks[2].level).toBeCloseTo(13.9)
  })

  it('FVG tăng chưa lấp và order block trước cú phá', () => {
    const c: Candle[] = [
      { t: -1, o: 9.9, h: 10, l: 9.8, c: 9.95 }, { t: 0, o: 9.95, h: 10.1, l: 9.85, c: 10 },
      { t: 1, o: 10, h: 10.5, l: 9.8, c: 10.2 }, { t: 2, o: 10.2, h: 10.4, l: 9.9, c: 10 },
      { t: 3, o: 10, h: 10.3, l: 9.7, c: 9.8 }, { t: 4, o: 9.8, h: 10.1, l: 9.6, c: 10 }, { t: 5, o: 10, h: 10.2, l: 9.85, c: 10.1 },
      { t: 6, o: 10.1, h: 10.3, l: 9.9, c: 9.95 }, // nến giảm cuối cùng: order block
      { t: 7, o: 9.95, h: 11.5, l: 9.95, c: 11.4 }, // nến bùng nổ
      { t: 8, o: 11.4, h: 12, l: 11, c: 11.9 }, // FVG: đáy 11 > đỉnh nến t6 10.3
      { t: 9, o: 11.9, h: 12.2, l: 11.6, c: 12.1 }, { t: 10, o: 12.1, h: 12.3, l: 11.7, c: 12 },
    ]
    const f = tfFeatures('M15', c, 2, 2)
    expect(f.fvg).toContainEqual(expect.objectContaining({ dir: 'bull', top: 11, bottom: 10.3, touched: false }))
    expect(f.breaks[0]).toMatchObject({ kind: 'BOS', dir: 'up', level: 10.5 })
    expect(f.order_blocks[0]).toMatchObject({ dir: 'bull', top: 10.3, bottom: 9.9 })
  })

  it('đỉnh bằng nhau chưa bị quét và vị trí premium/discount', () => {
    const c = fromCloses([10, 11, 12, 11, 10, 11, 12, 11, 10, 10.5, 11])
    const f = tfFeatures('H1', c, 2, 2)
    expect(f.equal_highs).toEqual([12.1])
    expect(f.range).toMatchObject({ high: 12.1, low: 9.9 })
    expect(f.range!.position_pct).toBe(50)
  })

  it('đỉnh đáy ngày trước, tuần trước, biên phiên Á', () => {
    const day = 86400
    const mon = Date.UTC(2026, 10, 9) / 1000 // thứ Hai 9/11/2026
    const d1: Candle[] = Array.from({ length: 8 }, (_, i) => ({ t: mon + i * day, o: 1, c: 1, h: 2 + i, l: 0.5 - i * 0.01 }))
    const m15: Candle[] = [
      { t: mon + 7 * day + 2 * 3600 + 3600, o: 1, c: 1, h: 1.3, l: 0.9 }, // 01:00 UTC (máy chủ UTC+2 -> 03:00)
      { t: mon + 7 * day + 2 * 3600 + 5 * 3600, o: 1, c: 1, h: 1.5, l: 0.95 }, // 05:00 UTC
      { t: mon + 7 * day + 2 * 3600 + 9 * 3600, o: 1, c: 1, h: 3, l: 0.1 }, // 09:00 UTC, ngoài phiên Á
    ]
    const lv = referenceLevels(d1, m15, 2, 2)
    expect(lv).toMatchObject({ prev_day_high: 8, prev_day_low: 0.44, prev_week_high: 8, prev_week_low: 0.44, asia_high: 1.5, asia_low: 0.9 })
  })
})
