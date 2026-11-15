import { normalizeSymbol } from './forex'
import type { Mt5Deal, Mt5Order } from './bridge'
import type { Trade } from './types'

/**
 * Ghép deal thô thành lệnh đã đóng, theo positionId.
 * id dùng chung dạng "mt5:<position>" với file báo cáo HTML, nên hai nguồn không tạo lệnh trùng.
 * SL/TP lấy từ lệnh mở vị thế, tức mức đặt ban đầu.
 */
export function dealsToTrades(deals: Mt5Deal[], orders: Mt5Order[]): Trade[] {
  const groups = new Map<number, Mt5Deal[]>()
  for (const d of deals) {
    if ((d.type !== 0 && d.type !== 1) || !d.positionId) continue
    const g = groups.get(d.positionId)
    if (g) g.push(d)
    else groups.set(d.positionId, [d])
  }
  const firstOrder = new Map<number, Mt5Order>()
  for (const o of orders) {
    const cur = firstOrder.get(o.positionId)
    if (!cur || o.time < cur.time) firstOrder.set(o.positionId, o)
  }

  const out: Trade[] = []
  for (const [pos, g] of groups) {
    g.sort((a, b) => a.time - b.time || a.ticket - b.ticket)
    const ins = g.filter((d) => d.entry === 0)
    const outs = g.filter((d) => d.entry !== 0)
    const volIn = ins.reduce((s, d) => s + d.volume, 0)
    const volOut = outs.reduce((s, d) => s + d.volume, 0)
    // Bỏ vị thế còn mở (hoặc mới đóng một phần) và vị thế mở trước khoảng thời gian đã tải.
    if (!ins.length || !outs.length || volOut < volIn - 1e-8) continue
    const vwap = (ds: Mt5Deal[], vol: number) => ds.reduce((s, d) => s + d.price * d.volume, 0) / vol
    const sum = (f: (d: Mt5Deal) => number) => g.reduce((s, d) => s + f(d), 0)
    const order = firstOrder.get(pos)
    out.push({
      id: `mt5:${pos}`,
      ticket: String(pos),
      symbol: normalizeSymbol(ins[0].symbol),
      side: ins[0].type === 0 ? 'buy' : 'sell',
      volume: Math.round(volIn * 1e6) / 1e6,
      openTime: ins[0].time * 1000,
      closeTime: outs[outs.length - 1].time * 1000,
      openPrice: vwap(ins, volIn),
      closePrice: vwap(outs, volOut),
      sl: order?.sl || 0,
      tp: order?.tp || 0,
      commission: Math.round(sum((d) => d.commission + (d.fee || 0)) * 100) / 100,
      swap: Math.round(sum((d) => d.swap) * 100) / 100,
      profit: Math.round(sum((d) => d.profit) * 100) / 100,
      source: 'mt5',
    })
  }
  return out.sort((a, b) => a.closeTime - b.closeTime)
}
