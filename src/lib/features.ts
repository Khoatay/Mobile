import type { Candle } from './bridge'
import { parseSymbol, pipSize } from './forex'
import { trendOf } from './signals'

/**
 * Đặc điểm giá tính sẵn từ nến, gửi cho agent phân tích. Agent không tự nhìn biểu đồ mà dựa vào các
 * con số này, nên mọi mức giá nó đưa ra đều kiểm tra lại được.
 */

export interface Swing { kind: 'high' | 'low'; price: number; label: 'HH' | 'LH' | 'HL' | 'LL' | ''; time: string }
export interface Break { kind: 'BOS' | 'CHoCH'; dir: 'up' | 'down'; level: number; time: string }
export interface Zone { dir: 'bull' | 'bear'; top: number; bottom: number; time: string; touched: boolean }
export interface TfFeatures {
  tf: string
  close: number
  atr: number
  ema_trend: 'up' | 'down' | 'flat' | null
  structure: 'bullish' | 'bearish' | 'mixed'
  swings: Swing[]
  breaks: Break[]
  fvg: Zone[]
  order_blocks: Zone[]
  equal_highs: number[]
  equal_lows: number[]
  /** Vị trí giá trong biên swing gần nhất: dưới 50% là discount, trên 50% là premium. */
  range: { high: number; low: number; position_pct: number } | null
}

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ')

export function atr(c: Candle[], n = 14): number {
  if (c.length < 2) return 0
  const tr = c.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - c[i].c), Math.abs(x.l - c[i].c)))
  const last = tr.slice(-n)
  return last.reduce((a, b) => a + b, 0) / last.length
}

/** Đỉnh/đáy fractal: cao (thấp) nhất trong k nến mỗi bên. Chỉ xác nhận sau khi đủ k nến bên phải. */
export function swings(c: Candle[], k = 3): { i: number; kind: 'high' | 'low'; price: number }[] {
  const out: { i: number; kind: 'high' | 'low'; price: number }[] = []
  for (let i = k; i < c.length - k; i++) {
    const left = c.slice(i - k, i), right = c.slice(i + 1, i + 1 + k)
    if (left.every((x) => x.h < c[i].h) && right.every((x) => x.h <= c[i].h)) out.push({ i, kind: 'high', price: c[i].h })
    if (left.every((x) => x.l > c[i].l) && right.every((x) => x.l >= c[i].l)) out.push({ i, kind: 'low', price: c[i].l })
  }
  return out
}

export function tfFeatures(tf: string, c: Candle[], digits: number, k = 3): TfFeatures {
  const r = (v: number) => Number(v.toFixed(digits))
  const a = atr(c)
  const sw = swings(c, k)

  // Gắn nhãn HH/LH/HL/LL so với đỉnh (đáy) trước đó.
  let prevH: number | null = null, prevL: number | null = null
  const labelled = sw.map((s) => {
    let label: Swing['label'] = ''
    if (s.kind === 'high') { if (prevH != null) label = s.price > prevH ? 'HH' : 'LH'; prevH = s.price }
    else { if (prevL != null) label = s.price > prevL ? 'HL' : 'LL'; prevL = s.price }
    return { ...s, label }
  })
  const lastHigh = [...labelled].reverse().find((s) => s.kind === 'high')
  const lastLow = [...labelled].reverse().find((s) => s.kind === 'low')
  const structure: TfFeatures['structure'] =
    lastHigh?.label === 'HH' && lastLow?.label === 'HL' ? 'bullish' : lastHigh?.label === 'LH' && lastLow?.label === 'LL' ? 'bearish' : 'mixed'

  // Phá cấu trúc: giá đóng cửa vượt đỉnh (đáy) swing gần nhất đã xác nhận. Ngược xu hướng trước đó là CHoCH.
  const breaks: (Break & { i: number })[] = []
  let trend: 'up' | 'down' | null = null
  let hi: { i: number; price: number; used: boolean } | null = null
  let lo: { i: number; price: number; used: boolean } | null = null
  const confirmAt = new Map<number, typeof sw>()
  for (const s of sw) confirmAt.set(s.i + k, [...(confirmAt.get(s.i + k) ?? []), s])
  for (let i = 0; i < c.length; i++) {
    for (const s of confirmAt.get(i) ?? []) {
      if (s.kind === 'high') hi = { i: s.i, price: s.price, used: false }
      else lo = { i: s.i, price: s.price, used: false }
    }
    if (hi && !hi.used && c[i].c > hi.price) {
      breaks.push({ kind: trend === 'down' ? 'CHoCH' : 'BOS', dir: 'up', level: r(hi.price), time: iso(c[i].t), i })
      trend = 'up'; hi.used = true
    }
    if (lo && !lo.used && c[i].c < lo.price) {
      breaks.push({ kind: trend === 'up' ? 'CHoCH' : 'BOS', dir: 'down', level: r(lo.price), time: iso(c[i].t), i })
      trend = 'down'; lo.used = true
    }
  }

  // FVG: khoảng trống giữa nến 1 và nến 3, lớn hơn 10% ATR, chưa bị lấp hết.
  const fvg: Zone[] = []
  for (let i = 2; i < c.length; i++) {
    const bull = c[i].l - c[i - 2].h, bear = c[i - 2].l - c[i].h
    if (bull > a * 0.1) {
      const after = c.slice(i + 1)
      if (!after.some((x) => x.l <= c[i - 2].h)) fvg.push({ dir: 'bull', top: r(c[i].l), bottom: r(c[i - 2].h), time: iso(c[i - 1].t), touched: after.some((x) => x.l < c[i].l) })
    } else if (bear > a * 0.1) {
      const after = c.slice(i + 1)
      if (!after.some((x) => x.h >= c[i - 2].l)) fvg.push({ dir: 'bear', top: r(c[i - 2].l), bottom: r(c[i].h), time: iso(c[i - 1].t), touched: after.some((x) => x.h > c[i].h) })
    }
  }

  // Order block: nến ngược chiều cuối cùng trước cú phá cấu trúc. Bỏ nếu giá đã đóng cửa xuyên qua.
  const order_blocks: Zone[] = []
  for (const b of breaks.slice(-6)) {
    for (let j = b.i - 1; j >= Math.max(0, b.i - 20); j--) {
      const down = c[j].c < c[j].o, up = c[j].c > c[j].o
      if ((b.dir === 'up' && down) || (b.dir === 'down' && up)) {
        const after = c.slice(b.i + 1)
        const broken = b.dir === 'up' ? after.some((x) => x.c < c[j].l) : after.some((x) => x.c > c[j].h)
        if (!broken) order_blocks.push({ dir: b.dir === 'up' ? 'bull' : 'bear', top: r(c[j].h), bottom: r(c[j].l), time: iso(c[j].t), touched: b.dir === 'up' ? after.some((x) => x.l <= c[j].h) : after.some((x) => x.h >= c[j].l) })
        break
      }
    }
  }

  // Thanh khoản: hai đỉnh (đáy) swing gần bằng nhau (lệch dưới 10% ATR) mà giá chưa vượt qua.
  const eq = (kind: 'high' | 'low') => {
    const list = sw.filter((s) => s.kind === kind).slice(-10)
    const out: number[] = []
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      if (Math.abs(list[x].price - list[y].price) > a * 0.1) continue
      const level = kind === 'high' ? Math.max(list[x].price, list[y].price) : Math.min(list[x].price, list[y].price)
      const taken = c.slice(list[y].i + 1).some((v) => (kind === 'high' ? v.h > level : v.l < level))
      if (!taken && !out.includes(r(level))) out.push(r(level))
    }
    return out.slice(-3)
  }

  const close = c[c.length - 1]?.c ?? 0
  const range = lastHigh && lastLow && lastHigh.price > lastLow.price
    ? { high: r(lastHigh.price), low: r(lastLow.price), position_pct: Math.round(((close - lastLow.price) / (lastHigh.price - lastLow.price)) * 100) }
    : null

  return {
    tf, close: r(close), atr: r(a), ema_trend: trendOf(c), structure,
    swings: labelled.slice(-8).map((s) => ({ kind: s.kind, price: r(s.price), label: s.label, time: iso(c[s.i].t) })),
    breaks: breaks.slice(-4).map(({ i: _i, ...b }) => b),
    fvg: [...fvg.filter((z) => z.dir === 'bull').slice(-3), ...fvg.filter((z) => z.dir === 'bear').slice(-3)],
    order_blocks: [...order_blocks.filter((z) => z.dir === 'bull').slice(-2), ...order_blocks.filter((z) => z.dir === 'bear').slice(-2)],
    equal_highs: eq('high'), equal_lows: eq('low'), range,
  }
}

export interface MarketFeatures {
  symbol: string
  server_time: string
  pip_size: number
  price: { bid: number; ask: number } | null
  levels: { prev_day_high?: number; prev_day_low?: number; prev_week_high?: number; prev_week_low?: number; asia_high?: number; asia_low?: number }
  timeframes: TfFeatures[]
  open_positions: { side: string; volume: number; open: number; sl: number; tp: number }[]
}

/** Mức giá tham chiếu: đỉnh đáy ngày trước, tuần trước (từ D1) và biên phiên Á hôm nay (từ M15, 00–07 UTC). */
export function referenceLevels(d1: Candle[], m15: Candle[], serverOffset: number, digits: number): MarketFeatures['levels'] {
  const r = (v: number) => Number(v.toFixed(digits))
  const out: MarketFeatures['levels'] = {}
  if (d1.length >= 2) { out.prev_day_high = r(d1[d1.length - 2].h); out.prev_day_low = r(d1[d1.length - 2].l) }
  // Tuần theo giờ máy chủ, bắt đầu thứ Hai.
  const weekOf = (t: number) => { const d = new Date(t * 1000); const day = (d.getUTCDay() + 6) % 7; return Math.floor(t / 86400) - day }
  if (d1.length) {
    const thisWeek = weekOf(d1[d1.length - 1].t)
    const prev = d1.filter((x) => weekOf(x.t) < thisWeek)
    const lastWeek = prev.length ? weekOf(prev[prev.length - 1].t) : null
    const w = prev.filter((x) => weekOf(x.t) === lastWeek)
    if (w.length) { out.prev_week_high = r(Math.max(...w.map((x) => x.h))); out.prev_week_low = r(Math.min(...w.map((x) => x.l))) }
  }
  if (m15.length) {
    const lastUtcDay = Math.floor((m15[m15.length - 1].t - serverOffset * 3600) / 86400)
    const asia = m15.filter((x) => { const u = x.t - serverOffset * 3600; return Math.floor(u / 86400) === lastUtcDay && (u % 86400) < 7 * 3600 })
    if (asia.length) { out.asia_high = r(Math.max(...asia.map((x) => x.h))); out.asia_low = r(Math.min(...asia.map((x) => x.l))) }
  }
  return out
}

export const ANALYSIS_TFS: { tf: string; count: number; k: number }[] = [
  { tf: 'D1', count: 160, k: 3 },
  { tf: 'H4', count: 300, k: 3 },
  { tf: 'H1', count: 300, k: 3 },
  { tf: 'M15', count: 400, k: 2 },
]

export function digitsOf(symbol: string): number {
  const info = parseSymbol(symbol)
  if (!info) return 5
  const pip = pipSize(info)
  return pip >= 0.1 ? 2 : pip >= 0.01 ? 3 : 5
}
