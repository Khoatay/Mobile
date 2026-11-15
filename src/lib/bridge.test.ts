import { describe, expect, it } from 'vitest'
import type { Candle, Mt5Deal, TgMessage } from './bridge'
import { dealsToTrades } from './mt5deals'
import { channelStats, confluence, demoMessages, evaluateSignal, parseSignal, riskReward, trendOf, type Signal } from './signals'

const deal = (d: Partial<Mt5Deal>): Mt5Deal => ({ ticket: 1, positionId: 1, time: 0, type: 0, entry: 0, symbol: 'EURUSD', volume: 0.1, price: 1, commission: 0, fee: 0, swap: 0, profit: 0, ...d })

describe('dealsToTrades', () => {
  const deals = [
    deal({ ticket: 1, positionId: 0, type: 2, profit: 10000 }), // nạp tiền
    deal({ ticket: 2, positionId: 77, time: 1000, type: 0, entry: 0, symbol: 'EURUSD.m', volume: 0.2, price: 1.08, commission: -0.7 }),
    deal({ ticket: 3, positionId: 77, time: 2000, type: 1, entry: 1, symbol: 'EURUSD.m', volume: 0.1, price: 1.09, profit: 100, commission: -0.35 }),
    deal({ ticket: 4, positionId: 77, time: 3000, type: 1, entry: 1, symbol: 'EURUSD.m', volume: 0.1, price: 1.1, profit: 200, swap: -1, commission: -0.35, fee: -0.1 }),
    deal({ ticket: 5, positionId: 88, time: 4000, type: 1, entry: 0, symbol: 'XAUUSD', volume: 1, price: 2600 }), // còn mở
    deal({ ticket: 6, positionId: 99, time: 500, type: 0, entry: 1, symbol: 'GBPUSD', volume: 1, price: 1.27, profit: 5 }), // mở trước khoảng tải
  ]
  it('ghép đóng từng phần, bỏ vị thế mở và deal không phải giao dịch', () => {
    const t = dealsToTrades(deals, [{ positionId: 77, time: 1000, sl: 1.075, tp: 1.1 }, { positionId: 77, time: 2000, sl: 0, tp: 0 }])
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ id: 'mt5:77', symbol: 'EURUSD', side: 'buy', volume: 0.2, openTime: 1_000_000, closeTime: 3_000_000, sl: 1.075, tp: 1.1, profit: 300, swap: -1, commission: -1.5 })
    expect(t[0].closePrice).toBeCloseTo(1.095)
  })
})

const msg = (text: string, channel = 'A', id = 1, date = 1000): TgMessage => ({ channel, id, date, text })

describe('parseSignal', () => {
  it('dạng chuẩn nhiều dòng', () => {
    const s = parseSignal(msg('XAUUSD BUY NOW @ 2598\nSL: 2590\nTP1: 2606\nTP2: 2614'))!
    expect(s).toMatchObject({ symbol: 'XAUUSD', side: 'buy', entry: 2598, sl: 2590, tps: [2606, 2614] })
    expect(riskReward(s)).toBeCloseTo(1)
  })
  it('vùng giá vào, từ khoá viết đầy đủ, tên gọi khác', () => {
    expect(parseSignal(msg('🔥 GOLD LONG\nEntry 2596 - 2600\nStop loss 2589\nTake profit 2612'))).toMatchObject({ symbol: 'XAUUSD', side: 'buy', entry: 2598, sl: 2589, tps: [2612] })
  })
  it('tiếng Việt trên một dòng', () => {
    expect(parseSignal(msg('Mua vàng vùng 2597, cắt lỗ 2588, chốt lời 2615'))).toMatchObject({ symbol: 'XAUUSD', side: 'buy', entry: 2597, sl: 2588, tps: [2615] })
  })
  it('một dòng, cặp có dấu gạch chéo, lệnh chờ', () => {
    expect(parseSignal(msg('EUR/USD buy limit 1.0800 sl 1.0770 tp 1.0860'))).toMatchObject({ symbol: 'EURUSD', side: 'buy', entry: 1.08, sl: 1.077, tps: [1.086] })
    expect(parseSignal(msg('GBPJPY SELL @ 190.50, SL 191.20, TP1 189.60 TP2 188.80'))).toMatchObject({ symbol: 'GBPJPY', side: 'sell', entry: 190.5, sl: 191.2, tps: [189.6, 188.8] })
  })
  it('"TP 1: giá" không nhầm số thứ tự thành giá; bỏ TP tính bằng pip', () => {
    expect(parseSignal(msg('USDJPY SELL 150.20\nSL 150.80\nTP 1: 149.60\nTP 2: 149.00'))!.tps).toEqual([149.6, 149])
    expect(parseSignal(msg('EURUSD BUY 1.0800\nSL 30 pips\nTP 60 pips'))).toMatchObject({ entry: 1.08, sl: null, tps: [] })
  })
  it('chỉ có chiều lệnh', () => {
    expect(parseSignal(msg('Sell GBPUSD now'))).toMatchObject({ symbol: 'GBPUSD', side: 'sell', entry: null, sl: null, tps: [] })
  })
  it('bỏ tin cập nhật kết quả và tin thường', () => {
    expect(parseSignal(msg('XAUUSD TP1 hit ✅ +80 pips'))).toBeNull()
    expect(parseSignal(msg('GOLD buy closed at breakeven'))).toBeNull()
    expect(parseSignal(msg('Chúc cả nhà tuần mới giao dịch thuận lợi!'))).toBeNull()
    expect(parseSignal(msg('BUY THE DIP today'))).toBeNull()
  })
  it('loại SL/TP nằm sai phía', () => {
    expect(parseSignal(msg('EURUSD BUY 1.0800\nSL 1.0850\nTP 1.0900'))).toMatchObject({ sl: null, tps: [1.09] })
  })
})

const sig = (p: Partial<Signal>): Signal => ({ id: Math.random() + '', channel: 'A', time: 0, symbol: 'XAUUSD', side: 'buy', entry: 100, sl: 90, tps: [120], text: '', ...p })
const H = 3_600_000

describe('confluence', () => {
  const now = 100 * H
  it('trùng khớp, xung đột, một nguồn; mỗi kênh chỉ tính lệnh mới nhất', () => {
    const list = [
      sig({ channel: 'A', time: now - H }), sig({ channel: 'B', time: now - 2 * H }),
      sig({ channel: 'A', time: now - 3 * H, side: 'sell' }), // bị lệnh mới hơn của A thay thế
      sig({ channel: 'A', symbol: 'EURUSD', side: 'sell', time: now - H }), sig({ channel: 'B', symbol: 'EURUSD', time: now - H }),
      sig({ channel: 'C', symbol: 'GBPJPY', side: 'sell', time: now - H }),
      sig({ channel: 'C', symbol: 'USDJPY', time: now - 30 * H }), // ngoài cửa sổ
    ]
    const c = confluence(list, now, 24, { XAUUSD: 'up' })
    expect(c.map((x) => [x.symbol, x.verdict])).toEqual([['XAUUSD', 'strong'], ['EURUSD', 'conflict'], ['GBPJPY', 'single']])
    expect(c[0].agree).toHaveLength(2)
    expect(c[0].avgRR).toBeCloseTo(2)
    expect(confluence(list, now, 24, { XAUUSD: 'down' })[0].verdict).toBe('counter')
    expect(confluence(list, now, 24)[0].verdict).toBe('agree')
  })
  it('tin mẫu cho ra đủ ba loại nhận định', () => {
    const now2 = Date.UTC(2026, 10, 15)
    const sigs = demoMessages(now2).map(parseSignal).filter((s): s is Signal => !!s)
    expect(sigs).toHaveLength(6)
    expect(confluence(sigs, now2, 24).map((x) => x.verdict)).toEqual(['agree', 'conflict', 'single'])
  })
})

const candle = (t: number, l: number, h: number): Candle => ({ t, o: (l + h) / 2, h, l, c: (l + h) / 2 })

describe('evaluateSignal', () => {
  const s = sig({ time: 1000_000 }) // đăng lúc 1000 giây UTC; máy chủ UTC+2 -> 8200
  it('chạm TP trước', () => {
    const r = evaluateSignal(s, [candle(8000, 80, 130), candle(8200, 99, 105), candle(9100, 101, 121)], 2)
    expect(r.outcome).toBe('tp')
    expect(r.r).toBeCloseTo(2)
  })
  it('chạm SL; một nến chạm cả hai tính là thua', () => {
    expect(evaluateSignal(s, [candle(8200, 99, 105), candle(9100, 89, 95)], 2).outcome).toBe('sl')
    expect(evaluateSignal(s, [candle(8200, 85, 125)], 2)).toEqual({ outcome: 'sl', r: -1 })
  })
  it('chưa khớp, chưa xong, thiếu SL/TP', () => {
    expect(evaluateSignal(s, [candle(8200, 101, 105), candle(8200 + 90000, 101, 105)], 2).outcome).toBe('unfilled')
    expect(evaluateSignal(s, [candle(8200, 99, 105)], 2).outcome).toBe('open')
    expect(evaluateSignal(sig({ sl: null }), [candle(8200, 99, 105)], 2).outcome).toBe('na')
  })
  it('không có giá vào thì lấy giá mở nến đầu tiên', () => {
    const r = evaluateSignal(sig({ time: 1000_000, entry: null }), [candle(8200, 99, 101), candle(9100, 100, 121)], 2)
    expect(r.outcome).toBe('tp')
    expect(r.r).toBeCloseTo(2)
  })
  it('thống kê theo kênh', () => {
    const a = sig({ channel: 'A' }), b = sig({ channel: 'A' }), c = sig({ channel: 'B' })
    const st = channelStats([a, b, c], new Map([[a.id, { outcome: 'tp' as const, r: 2 }], [b.id, { outcome: 'sl' as const, r: -1 }], [c.id, { outcome: 'open' as const, r: 0 }]]))
    expect(st[0]).toMatchObject({ channel: 'A', wins: 1, losses: 1, winRate: 0.5, totalR: 1 })
    expect(st[1]).toMatchObject({ channel: 'B', open: 1, winRate: null })
  })
})

describe('trendOf', () => {
  const series = (f: (i: number) => number) => Array.from({ length: 260 }, (_, i) => candle(i, f(i) - 1, f(i) + 1))
  it('tăng, giảm, đi ngang, thiếu dữ liệu', () => {
    expect(trendOf(series((i) => 100 + i))).toBe('up')
    expect(trendOf(series((i) => 500 - i))).toBe('down')
    expect(trendOf(series((i) => 100 + (i % 2)))).toBe('flat')
    expect(trendOf(series((i) => i).slice(0, 50))).toBeNull()
  })
})
