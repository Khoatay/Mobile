import { describe, expect, it } from 'vitest'
import { inPeriod, periodBounds, periodDays } from './period'

const now = Date.parse('2026-11-18T15:00:00Z')  // giờ máy chủ
const at = (s: string) => ({ closeTime: Date.parse(s) })

describe('khoảng thời gian', () => {
  it('hôm nay tính từ 0h giờ máy chủ; 3 ngày gồm hôm nay và 2 ngày trước', () => {
    expect(periodBounds({ kind: 'days', days: 1 }, now)[0]).toBe(Date.parse('2026-11-18T00:00:00Z'))
    const in3 = inPeriod({ kind: 'days', days: 3 }, now)
    expect(in3(at('2026-11-16T00:00:01Z'))).toBe(true)
    expect(in3(at('2026-11-15T23:59:59Z'))).toBe(false)
    expect(inPeriod({ kind: 'days', days: 0 }, now)(at('2000-01-01T00:00:00Z'))).toBe(true)
  })
  it('tự chọn ngày: gồm trọn ngày cuối', () => {
    const f = inPeriod({ kind: 'range', from: '2026-11-01', to: '2026-11-10' }, now)
    expect(f(at('2026-11-10T23:59:00Z'))).toBe(true)
    expect(f(at('2026-11-11T00:00:00Z'))).toBe(false)
    expect(f(at('2026-10-31T23:59:00Z'))).toBe(false)
  })
  it('số ngày lấy lịch sử MT5 đủ phủ khoảng đã chọn', () => {
    expect(periodDays({ kind: 'days', days: 7 }, now)).toBeGreaterThanOrEqual(7)
    expect(periodDays({ kind: 'range', from: '2026-11-01', to: '2026-11-05' }, now)).toBeGreaterThanOrEqual(18)
    expect(periodDays({ kind: 'days', days: 0 }, now)).toBe(3650)
  })
})
