import { parseSymbol } from './forex'
import type { Candle, TgMessage } from './bridge'
import type { Side } from './types'

export interface Signal {
  id: string
  channel: string
  /** Thời điểm đăng, epoch ms UTC thật. */
  time: number
  symbol: string
  side: Side
  entry: number | null
  sl: number | null
  tps: number[]
  text: string
}

const NUM = /\d+(?:[.,]\d+)?/g
const toNum = (s: string) => Number(s.replace(',', '.'))

/** Tin báo kết quả ("TP1 hit", "+50 pips", "closed") không phải lệnh mới. */
const UPDATE = /\b(HIT|CLOSED?|RUNNING|REACHED|DONE)\b|ĐÃ (CHẠM|ĐÓNG|CHỐT)|\+\s*\d+\s*PIPS?|✅/

/** \b của JavaScript không hiểu chữ có dấu, nên đổi từ khoá tiếng Việt và dạng viết dài về từ khoá ASCII trước. */
const VI = '(?<![A-ZÀ-Ỹ])(?:%s)(?![A-ZÀ-Ỹ])'
const ALIASES: [RegExp, string][] = ([
  ['CẮT LỖ|DỪNG LỖ|STOP\\s?LOSS', 'SL'],
  ['CHỐT LỜI|CHỐT LÃI|TAKE\\s?PROFIT', 'TP'],
  ['GIÁ VÀO|VÀO LỆNH|VÙNG|ZONE', 'ENTRY'],
  ['MUA|LONG', 'BUY'],
  ['BÁN|SHORT', 'SELL'],
  ['VÀNG', 'GOLD'],
  ['BẠC', 'SILVER'],
] as const).map(([from, to]) => [new RegExp(VI.replace('%s', from), 'g'), ` ${to} `])

function normalize(text: string): string {
  let t = text.toUpperCase()
  for (const [re, to] of ALIASES) t = t.replace(re, to)
  return t
}

function findSymbol(upper: string): string | null {
  if (/\bGOLD\b/.test(upper)) return 'XAUUSD'
  if (/\bSILVER\b/.test(upper)) return 'XAGUSD'
  for (const m of upper.matchAll(/\b([A-Z]{3})\s?\/?\s?([A-Z]{3})\b/g)) {
    const info = parseSymbol(m[1] + m[2])
    if (info) return info.symbol
  }
  return null
}

/** Các số trên phần còn lại của dòng sau từ khoá; bỏ số thứ tự ("TP 1: 2650") và số tính bằng pip. */
function numbersAfter(line: string): number[] {
  const cleaned = line.replace(/\d+(?:[.,]\d+)?\s*PIPS?/g, ' ')
  const nums = (cleaned.match(NUM) ?? []).map(toNum)
  if (nums.length > 1 && Number.isInteger(nums[0]) && nums[0] <= 9) nums.shift()
  return nums
}

function afterKeyword(upper: string, re: RegExp): number[] {
  const out: number[] = []
  for (const m of upper.matchAll(re)) {
    const rest = upper.slice(m.index! + m[0].length).split('\n', 1)[0]
    // Dừng ở từ khoá kế tiếp nếu nằm cùng dòng ("SL 2640 TP 2660").
    out.push(...numbersAfter(rest.split(/\b(?:SL|TP\d?|ENTRY)\b/)[0]))
  }
  return out
}

/**
 * Đọc lệnh từ một tin nhắn kênh tín hiệu bằng quy tắc cố định.
 * Trả null nếu không thấy cặp tiền và chiều lệnh, hoặc nếu là tin cập nhật kết quả.
 */
export function parseSignal(msg: TgMessage): Signal | null {
  const upper = normalize(msg.text)
  const symbol = findSymbol(upper)
  if (!symbol) return null
  const sideM = upper.match(/\b(BUY|SELL)\b/)
  if (!sideM) return null
  const side: Side = sideM[1] === 'BUY' ? 'buy' : 'sell'

  const sl: number | null = afterKeyword(upper, /\bSL\b/g)[0] ?? null
  const tps = afterKeyword(upper, /\bTP\d?\b/g)
  if (UPDATE.test(upper) && sl == null) return null

  // Giá vào: sau "ENTRY/@/GIÁ VÀO", nếu không thì các số ngay sau chiều lệnh. Một vùng giá lấy điểm giữa.
  let entryNums = afterKeyword(upper, /\bENTRY\b|@/g)
  if (!entryNums.length) {
    const rest = upper.slice(sideM.index! + sideM[0].length).split('\n', 1)[0]
    entryNums = numbersAfter(rest.split(/\b(?:SL|TP\d?)\b/)[0])
  }
  const zone = entryNums.slice(0, 2)
  let entry = zone.length ? zone.reduce((a, b) => a + b, 0) / zone.length : null

  // Loại số liệu vô lý: SL phải nằm phía thua, TP phía thắng so với giá vào.
  const dir = side === 'buy' ? 1 : -1
  const ref = entry ?? (sl != null && tps.length ? (sl + tps[0]) / 2 : null)
  let cleanSl: number | null = sl
  let cleanTps = tps
  if (ref != null) {
    if (sl != null && (ref - sl) * dir <= 0) cleanSl = null
    cleanTps = tps.filter((tp) => (tp - ref) * dir > 0)
  }
  if (entry != null && cleanSl == null && sl != null && !cleanTps.length) entry = null

  return { id: `${msg.channel}:${msg.id}`, channel: msg.channel, time: msg.date * 1000, symbol, side, entry, sl: cleanSl, tps: cleanTps, text: msg.text }
}

export function riskReward(s: Signal): number | null {
  if (s.entry == null || s.sl == null || !s.tps.length) return null
  const risk = Math.abs(s.entry - s.sl)
  return risk > 0 ? Math.abs(s.tps[0] - s.entry) / risk : null
}

export type Trend = 'up' | 'down' | 'flat'

function ema(values: number[], period: number): number {
  const k = 2 / (period + 1)
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k)
  return e
}

/**
 * Xu hướng đơn giản: giá > EMA50 > EMA200 là tăng, ngược lại là giảm, còn lại là đi ngang.
 * Hai đường EMA cách nhau dưới 0.1% cũng coi là đi ngang. Cần ít nhất 200 nến.
 */
export function trendOf(candles: Candle[]): Trend | null {
  if (candles.length < 200) return null
  const closes = candles.map((c) => c.c)
  const last = closes[closes.length - 1]
  const e50 = ema(closes, 50)
  const e200 = ema(closes, 200)
  if (Math.abs(e50 - e200) / e200 < 0.001) return 'flat'
  if (last > e50 && e50 > e200) return 'up'
  if (last < e50 && e50 < e200) return 'down'
  return 'flat'
}

export type Outcome = 'tp' | 'sl' | 'open' | 'unfilled' | 'na'

/**
 * Chấm một lệnh đã đăng bằng nến sau thời điểm đăng: chạm TP1 hay SL trước.
 * Nếu một nến chạm cả hai thì tính là thua. Bỏ qua spread. Lệnh chờ quá 24 giờ không khớp tính là "unfilled".
 */
export function evaluateSignal(s: Signal, candles: Candle[], serverOffset: number): { outcome: Outcome; r: number } {
  if (s.sl == null || !s.tps.length) return { outcome: 'na', r: 0 }
  const start = s.time / 1000 + serverOffset * 3600
  const after = candles.filter((c) => c.t >= start)
  if (!after.length) return { outcome: 'na', r: 0 }
  const dir = s.side === 'buy' ? 1 : -1
  const tp = s.tps[0]
  let entry = s.entry
  let i = 0
  if (entry == null) entry = after[0].o
  else {
    while (i < after.length && !(after[i].l <= entry && entry <= after[i].h)) {
      if (after[i].t - start > 86400) return { outcome: 'unfilled', r: 0 }
      i++
    }
    if (i >= after.length) return { outcome: 'unfilled', r: 0 }
  }
  const risk = (entry - s.sl) * dir
  if (!(risk > 0) || (tp - entry) * dir <= 0) return { outcome: 'na', r: 0 }
  for (; i < after.length; i++) {
    const c = after[i]
    if (dir > 0 ? c.l <= s.sl : c.h >= s.sl) return { outcome: 'sl', r: -1 }
    if (dir > 0 ? c.h >= tp : c.l <= tp) return { outcome: 'tp', r: ((tp - entry) * dir) / risk }
  }
  return { outcome: 'open', r: 0 }
}

export interface ChannelStat { channel: string; signals: number; wins: number; losses: number; open: number; winRate: number | null; totalR: number }

export function channelStats(signals: Signal[], outcomes: Map<string, { outcome: Outcome; r: number }>): ChannelStat[] {
  const map = new Map<string, ChannelStat>()
  for (const s of signals) {
    const st = map.get(s.channel) ?? { channel: s.channel, signals: 0, wins: 0, losses: 0, open: 0, winRate: null, totalR: 0 }
    st.signals++
    const o = outcomes.get(s.id)
    if (o?.outcome === 'tp') st.wins++
    else if (o?.outcome === 'sl') st.losses++
    else if (o?.outcome === 'open') st.open++
    st.totalR += o?.r ?? 0
    map.set(s.channel, st)
  }
  const out = [...map.values()]
  for (const st of out) st.winRate = st.wins + st.losses ? st.wins / (st.wins + st.losses) : null
  return out.sort((a, b) => b.totalR - a.totalR)
}

export type Verdict = 'strong' | 'agree' | 'counter' | 'conflict' | 'single'

export interface Confluence {
  symbol: string
  side: Side
  /** Các kênh cùng chiều với đa số, và các kênh ngược chiều. */
  agree: Signal[]
  against: Signal[]
  trend: Trend | null
  avgRR: number | null
  verdict: Verdict
  reasons: string[]
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  strong: 'Trùng khớp cao',
  agree: 'Trùng khớp',
  counter: 'Ngược xu hướng',
  conflict: 'Xung đột',
  single: 'Một nguồn',
}

/**
 * Gom lệnh theo cặp tiền trong cửa sổ thời gian. Mỗi kênh chỉ tính lệnh mới nhất của nó cho mỗi cặp.
 * Lưu ý: nhiều kênh cùng chiều chưa chắc là bằng chứng độc lập, vì các kênh hay sao chép nhau.
 */
export function confluence(signals: Signal[], now: number, windowHours: number, trends: Record<string, Trend | null> = {}): Confluence[] {
  const latest = new Map<string, Signal>()
  for (const s of signals) {
    if (s.time > now || now - s.time > windowHours * 3_600_000) continue
    const key = s.symbol + '|' + s.channel
    const cur = latest.get(key)
    if (!cur || s.time > cur.time) latest.set(key, s)
  }
  const bySymbol = new Map<string, Signal[]>()
  for (const s of latest.values()) bySymbol.set(s.symbol, [...(bySymbol.get(s.symbol) ?? []), s])

  const out: Confluence[] = []
  for (const [symbol, list] of bySymbol) {
    const buys = list.filter((s) => s.side === 'buy')
    const sells = list.filter((s) => s.side === 'sell')
    const side: Side = buys.length >= sells.length ? 'buy' : 'sell'
    const agree = side === 'buy' ? buys : sells
    const against = side === 'buy' ? sells : buys
    const trend = trends[symbol] ?? null
    const aligned = trend === (side === 'buy' ? 'up' : 'down')
    const opposed = trend === (side === 'buy' ? 'down' : 'up')
    const rrs = agree.map(riskReward).filter((r): r is number => r != null)
    const avgRR = rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : null

    const verdict: Verdict = against.length ? 'conflict' : agree.length < 2 ? 'single' : opposed ? 'counter' : aligned ? 'strong' : 'agree'
    const reasons: string[] = [`${agree.length} kênh ${side === 'buy' ? 'Buy' : 'Sell'}`]
    if (against.length) reasons.push(`${against.length} kênh ngược chiều`)
    if (trend && against.length) reasons.push(trend === 'up' ? 'H4 đang tăng' : trend === 'down' ? 'H4 đang giảm' : 'H4 đi ngang')
    else if (trend) reasons.push(aligned ? 'thuận xu hướng H4' : opposed ? 'ngược xu hướng H4' : 'H4 đi ngang')
    if (avgRR != null) reasons.push(`R:R trung bình 1:${avgRR.toFixed(1)}${avgRR < 1 ? ' (thấp)' : ''}`)
    out.push({ symbol, side, agree, against, trend, avgRR, verdict, reasons })
  }
  const rank: Record<Verdict, number> = { strong: 0, agree: 1, counter: 2, conflict: 3, single: 4 }
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.agree.length - a.agree.length)
}

/** Tin mẫu để xem thử màn hình khi chưa kết nối Telegram. */
export function demoMessages(now: number): TgMessage[] {
  const t = (hoursAgo: number) => Math.floor(now / 1000 - hoursAgo * 3600)
  return [
    { channel: 'Kênh mẫu A', id: 1, date: t(1.5), text: 'XAUUSD BUY NOW @ 2598\nSL: 2590\nTP1: 2606\nTP2: 2614' },
    { channel: 'Kênh mẫu B', id: 2, date: t(1.2), text: '🔥 GOLD LONG\nEntry 2596 - 2600\nStop loss 2589\nTake profit 2612' },
    { channel: 'Kênh mẫu C', id: 3, date: t(0.8), text: 'Mua vàng vùng 2597, cắt lỗ 2588, chốt lời 2615' },
    { channel: 'Kênh mẫu A', id: 4, date: t(3), text: 'EURUSD SELL 1.0830\nSL 1.0860\nTP 1.0780' },
    { channel: 'Kênh mẫu B', id: 5, date: t(2.5), text: 'EUR/USD buy limit 1.0800 sl 1.0770 tp 1.0860' },
    { channel: 'Kênh mẫu C', id: 6, date: t(5), text: 'GBPJPY SELL @ 190.50, SL 191.20, TP1 189.60 TP2 188.80' },
    { channel: 'Kênh mẫu A', id: 7, date: t(4), text: 'XAUUSD TP1 hit ✅ +80 pips' },
    { channel: 'Kênh mẫu B', id: 8, date: t(6), text: 'Chúc cả nhà tuần mới giao dịch thuận lợi!' },
  ]
}
