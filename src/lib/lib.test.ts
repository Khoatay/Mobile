import { describe, expect, it } from 'vitest'
import { calcPosition, normalizeSymbol, PAIRS, SAMPLE_QUOTES } from './forex'
import { decodeFile, parseReport, parseTime, toCsv } from './parse'
import { computeStats, rMultiple, sessionOf } from './stats'
import { mergeTrades } from './store'
import { demoTrades } from './demo'
import type { Trade } from './types'

const q = SAMPLE_QUOTES
const base = { accountCcy: 'USD', balance: 10000, riskPct: 1, leverage: 100, quotes: q }

describe('calcPosition', () => {
  it('EURUSD, tài khoản USD: 10 USD/pip/lot', () => {
    const r = calcPosition({ ...base, symbol: 'EURUSD', slPips: 20, tpPips: 40 })!
    expect(r.pipValuePerLot).toBeCloseTo(10)
    expect(r.lots).toBe(0.5)
    expect(r.actualRisk).toBeCloseTo(100)
    expect(r.margin).toBeCloseTo((0.5 * 100000 * 1.08) / 100)
    expect(r.rr).toBe(2)
    expect(r.reward).toBeCloseTo(200)
  })
  it('USDJPY: pip value = 1000 JPY quy ra USD', () => {
    const r = calcPosition({ ...base, symbol: 'USDJPY', slPips: 30 })!
    expect(r.pipValuePerLot).toBeCloseTo(1000 / 150)
    expect(r.lots).toBe(0.5)
    expect(r.margin).toBeCloseTo(500)
  })
  it('cặp chéo EURGBP: quy đổi qua GBPUSD', () => {
    const r = calcPosition({ ...base, symbol: 'EURGBP', slPips: 25 })!
    expect(r.pipValuePerLot).toBeCloseTo(12.7)
    expect(r.lots).toBe(0.31) // 100 / (25 * 12.7) = 0.3149 -> làm tròn xuống
    expect(r.actualRisk).toBeLessThanOrEqual(100)
  })
  it('vàng: 1 pip = 0.1 USD, 1 lot = 100 oz', () => {
    const r = calcPosition({ ...base, symbol: 'XAUUSD', slPips: 50 })!
    expect(r.pipValuePerLot).toBeCloseTo(10)
    expect(r.lots).toBe(0.2)
    expect(r.margin).toBeCloseTo((0.2 * 100 * 2600) / 100)
  })
  it('tài khoản EUR', () => {
    const r = calcPosition({ ...base, accountCcy: 'EUR', symbol: 'EURUSD', slPips: 20 })!
    expect(r.pipValuePerLot).toBeCloseTo(10 / 1.08)
    expect(r.margin).toBeCloseTo((r.lots * 100000) / 100)
  })
  it('không làm tròn lên do sai số số thực', () => {
    const r = calcPosition({ ...base, balance: 3000, symbol: 'EURUSD', slPips: 10 })!
    expect(r.lots).toBe(0.3)
  })
  it('đầu vào không hợp lệ -> null', () => {
    expect(calcPosition({ ...base, symbol: 'EURUSD', slPips: 0 })).toBeNull()
    expect(calcPosition({ ...base, symbol: 'BTCUSD', slPips: 10 })).toBeNull()
  })
  it('tính được cho mọi cặp trong danh sách', () => {
    expect(PAIRS).toHaveLength(30)
    for (const symbol of PAIRS) expect(calcPosition({ ...base, symbol, slPips: 20 })).not.toBeNull()
  })
})

describe('normalizeSymbol', () => {
  it('bỏ hậu tố broker', () => {
    expect(normalizeSymbol('EURUSD.m')).toBe('EURUSD')
    expect(normalizeSymbol('gbpjpy_pro')).toBe('GBPJPY')
    expect(normalizeSymbol('GOLD')).toBe('XAUUSD')
    expect(normalizeSymbol('XAUUSDm')).toBe('XAUUSD')
    expect(normalizeSymbol('US30.cash')).toBe('US30.CASH')
  })
})

const MT5 = `<html><body><table>
<tr><th colspan="14">Positions</th></tr>
<tr bgcolor="#E5F0FC"><td>Time</td><td>Position</td><td>Symbol</td><td>Type</td><td class="hidden" colspan="8"></td><td>Volume</td><td>Price</td><td>S / L</td><td>T / P</td><td>Time</td><td>Price</td><td>Commission</td><td>Swap</td><td colspan="2">Profit</td></tr>
<tr align="right"><td>2026.01.05 09:15:00</td><td>1001</td><td>EURUSD.m</td><td>buy</td><td class="hidden" colspan="8"></td><td>0.10</td><td>1.08500</td><td>1.08200</td><td>1.09100</td><td>2026.01.05 14:40:00</td><td>1.09020</td><td>-0.70</td><td>0.00</td><td colspan="2">52.00</td></tr>
<tr align="right"><td>2026.01.06 16:00:00</td><td>1002</td><td>XAUUSD</td><td>sell</td><td class="hidden" colspan="8"></td><td>1.50</td><td>2600.00</td><td></td><td></td><td>2026.01.07 02:00:00</td><td>2610.00</td><td>-10.50</td><td>-3.20</td><td colspan="2">-1 500.00</td></tr>
<tr><th colspan="14">Orders</th></tr>
<tr align="right"><td>2026.01.05 09:15:00</td><td>2001</td><td>EURUSD.m</td><td>buy</td><td>0.10 / 0.10</td><td>market</td><td>1.08200</td><td>1.09100</td><td>2026.01.05 09:15:00</td><td>filled</td><td></td></tr>
<tr><th colspan="14">Deals</th></tr>
<tr align="right"><td>2026.01.01 00:00:00</td><td>1</td><td></td><td>balance</td><td></td><td></td><td></td><td></td><td>0.00</td><td>0.00</td><td>0.00</td><td>10 000.00</td><td>10 000.00</td><td>Deposit</td></tr>
</table></body></html>`

const MT4 = `<html><body><table>
<tr><td colspan="14"><b>Closed Transactions:</b></td></tr>
<tr><td>Ticket</td><td>Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S / L</td><td>T / P</td><td>Close Time</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>
<tr><td>111</td><td>2026.02.02 10:00</td><td>balance</td><td colspan="10">Deposit</td><td>5 000.00</td></tr>
<tr><td>112</td><td>2026.02.02 10:30</td><td>sell</td><td>0.20</td><td>gbpusd</td><td>1.27000</td><td>1.27300</td><td>1.26400</td><td>2026.02.02 18:00</td><td>1.26400</td><td>-1.40</td><td>0.00</td><td>-0.50</td><td>120.00</td></tr>
<tr><td>113</td><td>2026.02.03 10:30</td><td>buy limit</td><td>0.20</td><td>gbpusd</td><td>1.26000</td><td>0</td><td>0</td><td>2026.02.03 12:00</td><td>1.26500</td><td colspan="4">cancelled</td></tr>
<tr><td colspan="14"><b>Open Trades:</b></td></tr>
<tr><td>114</td><td>2026.02.04 10:30</td><td>buy</td><td>0.20</td><td>eurusd</td><td>1.08000</td><td>0</td><td>0</td><td>&nbsp;</td><td>1.08100</td><td>0.00</td><td>0.00</td><td>0.00</td><td>20.00</td></tr>
</table></body></html>`

describe('parseReport', () => {
  it('MT5: chỉ lấy bảng Positions', () => {
    const r = parseReport(MT5)
    expect(r.format).toBe('mt5')
    expect(r.trades).toHaveLength(2)
    const [a, b] = r.trades
    expect(a).toMatchObject({ id: 'mt5:1001', symbol: 'EURUSD', side: 'buy', volume: 0.1, sl: 1.082, profit: 52, commission: -0.7 })
    expect(a.openTime).toBe(Date.UTC(2026, 0, 5, 9, 15))
    expect(b).toMatchObject({ symbol: 'XAUUSD', side: 'sell', sl: 0, profit: -1500, swap: -3.2 })
  })
  it('MT5 mã hoá UTF-16LE có BOM', () => {
    const bytes = new Uint8Array(2 + MT5.length * 2)
    bytes.set([0xff, 0xfe])
    for (let i = 0; i < MT5.length; i++) { bytes[2 + i * 2] = MT5.charCodeAt(i) & 255; bytes[3 + i * 2] = MT5.charCodeAt(i) >> 8 }
    expect(parseReport(decodeFile(bytes.buffer)).trades).toHaveLength(2)
  })
  it('MT4: bỏ balance, lệnh chờ huỷ và lệnh đang mở', () => {
    const r = parseReport(MT4)
    expect(r.format).toBe('mt4')
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]).toMatchObject({ id: 'mt4:112', symbol: 'GBPUSD', side: 'sell', volume: 0.2, commission: -1.4, swap: -0.5, profit: 120 })
  })
  it('CSV xuất ra đọc lại được nguyên vẹn', () => {
    const src = parseReport(MT5).trades.map((t) => ({ ...t, setup: 'Break, out', note: 'ghi "chú"' }))
    const back = parseReport(toCsv(src))
    expect(back.format).toBe('csv')
    expect(back.trades).toHaveLength(2)
    expect(back.trades[1]).toMatchObject({ symbol: 'XAUUSD', side: 'sell', profit: -1500, openTime: src[1].openTime })
  })
  it('CSV dấu chấm phẩy và thiếu cột', () => {
    const csv = 'Symbol;Type;Volume;Time;Price;Time;Price;Profit\nEURUSD;sell;0.1;2026-03-02 08:00;1.09;2026-03-02 09:00;1.088;20\n'
    const r = parseReport(csv)
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0].closePrice).toBe(1.088)
    expect(parseReport('symbol,profit\nEURUSD,1\n').trades).toHaveLength(0)
  })
  it('HTML không có lệnh', () => {
    expect(parseReport('<html><table><tr><td>x</td></tr></table></html>').format).toBe('unknown')
  })
  it('parseTime', () => {
    expect(parseTime('2026.01.05 09:15')).toBe(Date.UTC(2026, 0, 5, 9, 15))
    expect(parseTime('05/01/2026 09:15:30')).toBe(Date.UTC(2026, 0, 5, 9, 15, 30))
    expect(parseTime('abc')).toBeNaN()
  })
})

const mk = (i: number, profit: number, extra: Partial<Trade> = {}): Trade => ({
  id: 't' + i, ticket: String(i), symbol: 'EURUSD', side: 'buy', volume: 0.1,
  openTime: Date.UTC(2026, 0, 5 + i, 10), closeTime: Date.UTC(2026, 0, 5 + i, 12),
  openPrice: 1.08, closePrice: 1.081, sl: 0, tp: 0, commission: 0, swap: 0, profit, source: 'manual', ...extra,
})

describe('computeStats', () => {
  it('các chỉ số cơ bản', () => {
    const s = computeStats([mk(0, 100), mk(1, -50), mk(2, -30), mk(3, 60, { commission: -10 })], 2)
    expect(s.n).toBe(4)
    expect(s.winRate).toBe(0.5)
    expect(s.net).toBe(70)
    expect(s.profitFactor).toBeCloseTo(150 / 80)
    expect(s.expectancy).toBeCloseTo(17.5)
    expect(s.maxDrawdown).toBe(80)
    expect(s.maxLosingStreak).toBe(2)
    expect(s.equity.map((p) => p.v)).toEqual([100, 50, 20, 70])
    expect(s.bySymbol[0]).toMatchObject({ key: 'EURUSD', n: 4, net: 70 })
  })
  it('rỗng', () => {
    const s = computeStats([], 2)
    expect(s.n).toBe(0)
    expect(s.profitFactor).toBe(0)
    expect(s.avgR).toBeNull()
  })
  it('R-multiple', () => {
    expect(rMultiple(mk(0, 1, { openPrice: 1.08, sl: 1.078, closePrice: 1.084 }))).toBeCloseTo(2)
    expect(rMultiple(mk(0, 1, { side: 'sell', openPrice: 1.08, sl: 1.082, closePrice: 1.081 }))).toBeCloseTo(-0.5)
    expect(rMultiple(mk(0, 1, { openPrice: 1.08, sl: 1.081 }))).toBeNull() // SL đã dời qua điểm vào
    expect(rMultiple(mk(0, 1))).toBeNull()
  })
  it('phiên tính theo UTC sau khi trừ múi giờ máy chủ', () => {
    expect(sessionOf(Date.UTC(2026, 0, 5, 9), 2)).toMatch(/^Âu \(/)
    expect(sessionOf(Date.UTC(2026, 0, 5, 1), 2)).toMatch(/^Cuối ngày/)
    expect(sessionOf(Date.UTC(2026, 0, 5, 15), 2)).toMatch(/^Âu–Mỹ/)
  })
  it('dữ liệu mẫu hợp lệ và không rơi vào cuối tuần', () => {
    const d = demoTrades()
    expect(d).toHaveLength(90)
    expect(d.every((t) => ![0, 6].includes(new Date(t.openTime).getUTCDay()))).toBe(true)
    expect(computeStats(d, 2).n).toBe(90)
  })
})

describe('mergeTrades', () => {
  it('bỏ lệnh trùng', () => {
    const r = mergeTrades([mk(1, 1)], [mk(1, 1), mk(2, 1), mk(2, 1)])
    expect(r.added).toBe(1)
    expect(r.trades).toHaveLength(2)
  })
})
