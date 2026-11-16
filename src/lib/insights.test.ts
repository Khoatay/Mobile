import { describe, expect, it } from 'vitest'
import { computeInsights } from './insights'
import type { Trade } from './types'

const H = 3_600_000
let n = 0
const t = (open: number, holdH: number, profit: number, p: Partial<Trade> = {}): Trade => ({
  id: `t${++n}`, ticket: String(n), symbol: 'EURUSD', side: 'buy', volume: 0.1, openTime: open, closeTime: open + holdH * H,
  openPrice: 1.08, closePrice: profit > 0 ? 1.082 : 1.078, sl: 1.079, tp: 0, commission: 0, swap: 0, profit, source: 'manual', ...p,
})

describe('nhận xét tự động', () => {
  it('ít lệnh thì không kết luận', () => {
    expect(computeInsights([t(0, 1, 10), t(H * 5, 1, -10)], 2)).toEqual([])
  })
  it('phát hiện trade trả thù, gồng lỗ và phiên kém', () => {
    const list: Trade[] = []
    let time = Date.UTC(2026, 8, 1, 8)
    for (let i = 0; i < 30; i++) {
      // lệnh thắng giữ 3 giờ, phiên Âu
      list.push(t(time, 3, 50, { openTime: time }))
      time += 4 * H
      // lệnh thua giữ 6 giờ, rồi lệnh trả thù ngay 5 phút sau, cũng thua
      const loss = t(time, 6, -40)
      list.push(loss)
      list.push(t(loss.closeTime + 5 * 60_000, 5, -30, { symbol: 'GBPJPY' }))
      time = loss.closeTime + 20 * H
    }
    const ins = computeInsights(list, 2)
    const ids = ins.map((x) => x.id)
    expect(ids).toContain('revenge')
    expect(ids).toContain('hold')
    expect(ids).toContain('symbol-worst')
    expect(ins.find((x) => x.id === 'symbol-worst')!.title).toContain('GBPJPY')
    expect(ins[ins.length - 1].tone).not.toBe('bad')
    expect(ins.findIndex((x) => x.tone === 'good')).toBeGreaterThan(ins.findIndex((x) => x.tone === 'bad'))
  })
  it('lệnh không SL và lỗ vượt SL', () => {
    const list = Array.from({ length: 20 }, (_, i) => t(Date.UTC(2026, 8, 1) + i * 30 * H, 2, i % 2 ? 30 : -60, i % 2 ? { sl: 0 } : { closePrice: 1.0775 }))
    const ids = computeInsights(list, 2).map((x) => x.id)
    expect(ids).toContain('no-sl')
    expect(ids).toContain('beyond-sl')
  })
})

import { dataHash, trackData, trackRecordHtml } from './trackrecord'

describe('trang thành tích', () => {
  const list = [
    t(Date.UTC(2026, 8, 2, 8), 2, 40, { source: 'mt5', account: '1' }),
    t(Date.UTC(2026, 8, 3, 8), 2, -20, { source: 'mt5', account: '1' }),
    t(Date.UTC(2026, 9, 1, 8), 2, 30, { source: 'manual' }),
  ]
  it('số liệu theo tháng, pip khi ẩn tiền, tỷ lệ lệnh từ MT5', () => {
    const d = trackData(list, true)
    expect(d.months.map((m) => [m.month, m.n])).toEqual([['2026-09', 2], ['2026-10', 1]])
    expect(d.pips).toBeCloseTo(20 - 20 + 20)
    expect(d.curve).toHaveLength(4)
    expect(d.verifiedShare).toBeCloseTo(2 / 3)
  })
  it('trang HTML ẩn tiền và thoát ký tự đặc biệt; mã kiểm tra ổn định', async () => {
    const h1 = await dataHash(list), h2 = await dataHash([...list].reverse())
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64)
    const html = trackRecordHtml(list, { title: 'Thành tích <Alpha>', subtitle: '', brand: 'Alpha', accent: '#2a78d6', hideMoney: true, currency: 'USD', ctaLabel: 'Mở tài khoản', ctaUrl: 'https://vi.du/ib?a=1&b=2', disclaimer: true, recent: 10 }, h1)
    expect(html).toContain('Thành tích &lt;Alpha&gt;')
    expect(html).toContain('https://vi.du/ib?a=1&amp;b=2')
    expect(html).not.toContain('Lãi/lỗ ròng')
    expect(html).toContain('67% lệnh đọc thẳng từ MT5')
    expect(html).toContain(h1)
  })
})

import { DEFAULT_AUTOPOST, EMPTY_STATE, morningDue, morningText, newResults, weekKey, weeklyDue } from './autopost'

describe('đăng tự động', () => {
  const cfg = { ...DEFAULT_AUTOPOST, morning: { on: true, time: '07:30', withMedium: false }, weekly: { on: true, weekday: 5, time: '22:00' }, results: { on: true, accounts: ['A'], minNet: 5 } }
  it('tới giờ đăng buổi sáng và cuối tuần, mỗi lần một bài', () => {
    const fri = new Date(2026, 10, 20, 22, 5) // thứ Sáu
    expect(morningDue(cfg, EMPTY_STATE, new Date(2026, 10, 20, 7, 0))).toBe(false)
    expect(morningDue(cfg, EMPTY_STATE, fri)).toBe(true)
    expect(morningDue(cfg, { ...EMPTY_STATE, lastMorning: '2026-11-20' }, fri)).toBe(false)
    expect(weeklyDue(cfg, EMPTY_STATE, fri)).toBe(true)
    expect(weeklyDue(cfg, { ...EMPTY_STATE, lastWeekly: weekKey(fri) }, fri)).toBe(false)
    expect(weeklyDue(cfg, EMPTY_STATE, new Date(2026, 10, 19, 23, 0))).toBe(false)
    expect(weekKey(fri)).toBe('2026-11-16')
  })
  it('chỉ lấy lệnh mới, đúng tài khoản, đủ ngưỡng', () => {
    const start = Date.UTC(2026, 10, 20, 8)
    const mk = (id: string, account: string, closeUtc: number, profit: number) => ({ ...t(closeUtc - 3_600_000, 1, profit), id, account, closeTime: closeUtc + 2 * 3_600_000 })
    const list = [mk('a', 'A', start - 60_000, 50), mk('b', 'A', start + 60_000, 50), mk('c', 'B', start + 60_000, 50), mk('d', 'A', start + 120_000, 2), mk('e', 'A', start + 180_000, -20)]
    expect(newResults(list, cfg, { ...EMPTY_STATE, startedAt: start }, 2).map((x) => x.id)).toEqual(['b', 'e'])
    expect(newResults(list, cfg, { ...EMPTY_STATE, startedAt: start, seen: ['b'] }, 2).map((x) => x.id)).toEqual(['e'])
  })
  it('bài lịch tin hôm nay', () => {
    const now = new Date(2026, 10, 20, 7, 30)
    const at = (h: number) => new Date(2026, 10, 20, h, 30).toISOString()
    const text = morningText([{ title: 'NFP', currency: 'USD', date: at(20), impact: 'High', forecast: '180K', previous: '150K' }, { title: 'PMI', currency: 'EUR', date: at(16), impact: 'Medium', forecast: '', previous: '' }], now, false, '— Alpha')
    expect(text).toContain('thứ 6, 20/11/2026')
    expect(text).toContain('USD · NFP (dự báo 180K, trước 150K)')
    expect(text).not.toContain('PMI')
    expect(text).toContain('Cẩn thận với các cặp có USD')
    expect(text.endsWith('— Alpha')).toBe(true)
  })
})
