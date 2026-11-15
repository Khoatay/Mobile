import { normalizeSymbol } from './forex'
import type { Side, Trade } from './types'

export interface ParseResult {
  trades: Trade[]
  format: 'mt5' | 'mt4' | 'csv' | 'unknown'
  warnings: string[]
}

/** MT5 xuất báo cáo HTML dạng UTF-16LE; MT4 và CSV thường là UTF-8/ANSI. */
export function decodeFile(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  let zeros = 0
  const n = Math.min(b.length, 2000)
  for (let i = 1; i < n; i += 2) if (b[i] === 0) zeros++
  if (n > 20 && zeros > n / 4) return new TextDecoder('utf-16le').decode(b)
  return new TextDecoder('utf-8').decode(b)
}

/** "2024.01.02 10:00:00", "2024-01-02 10:00", "02/01/2024 10:00" -> epoch ms (coi như UTC). */
export function parseTime(s: string): number {
  const t = s.trim()
  let m = t.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  m = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  return NaN
}

export function parseNum(s: string | undefined): number {
  if (s == null) return 0
  const t = s.replace(/[\s ]/g, '')
  if (t === '') return 0
  return Number(t)
}

function parseSide(s: string, open: number, close: number, profit: number): Side {
  const t = s.toLowerCase()
  if (t.includes('sell') || t === 'short' || t === 's') return 'sell'
  if (t.includes('buy') || t === 'long' || t === 'b') return 'buy'
  // Báo cáo bản địa hoá: suy ra chiều từ biến động giá và dấu lợi nhuận.
  return Math.sign(close - open) * Math.sign(profit) >= 0 ? 'buy' : 'sell'
}

interface Raw {
  ticket: string; symbol: string; type: string; volume: string
  openTime: string; openPrice: string; sl: string; tp: string
  closeTime: string; closePrice: string; commission: string; swap: string; profit: string
}

function toTrade(r: Raw, source: Trade['source']): Trade | null {
  const openTime = parseTime(r.openTime)
  const closeTime = parseTime(r.closeTime)
  const openPrice = parseNum(r.openPrice)
  const closePrice = parseNum(r.closePrice)
  const profit = parseNum(r.profit)
  const volume = parseFloat(r.volume.replace(/[\s ]/g, ''))
  if (![openTime, closeTime, openPrice, closePrice, profit, volume].every(Number.isFinite)) return null
  if (!r.symbol.trim()) return null
  const ticket = r.ticket.trim() || `${openTime}-${r.symbol}-${volume}`
  return {
    id: `${source}:${ticket}`,
    ticket,
    symbol: normalizeSymbol(r.symbol),
    side: parseSide(r.type.trim(), openPrice, closePrice, profit),
    volume,
    openTime, closeTime, openPrice, closePrice,
    sl: parseNum(r.sl) || 0,
    tp: parseNum(r.tp) || 0,
    commission: parseNum(r.commission) || 0,
    swap: parseNum(r.swap) || 0,
    profit,
    source,
  }
}

const isTime = (s: string | undefined) => !!s && Number.isFinite(parseTime(s)) && /\d{4}/.test(s)

function htmlRows(text: string): string[][] {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  return Array.from(doc.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children)
      // MT5 chèn các ô ẩn (class="hidden") để căn cột; phải bỏ đi.
      .filter((c) => !c.classList.contains('hidden'))
      .map((c) => (c.textContent ?? '').replace(/ /g, ' ').trim()),
  )
}

/**
 * MT5, bảng Positions (13 ô):
 * Time | Position | Symbol | Type | Volume | Price | S/L | T/P | Time | Price | Commission | Swap | Profit
 */
function mt5Row(c: string[]): Raw | null {
  if (c.length !== 13 || !isTime(c[0]) || !isTime(c[8])) return null
  return {
    openTime: c[0], ticket: c[1], symbol: c[2], type: c[3], volume: c[4], openPrice: c[5],
    sl: c[6], tp: c[7], closeTime: c[8], closePrice: c[9], commission: c[10], swap: c[11], profit: c[12],
  }
}

/**
 * MT4, bảng Closed Transactions (14 ô):
 * Ticket | Open Time | Type | Size | Item | Price | S/L | T/P | Close Time | Price | Commission | Taxes | Swap | Profit
 */
function mt4Row(c: string[]): Raw | null {
  if (c.length !== 14 || !/^\d+$/.test(c[0]) || !isTime(c[1]) || !isTime(c[8])) return null
  if (!/^(buy|sell)$/i.test(c[2])) return null // bỏ lệnh chờ đã huỷ, balance, credit
  return {
    ticket: c[0], openTime: c[1], type: c[2], volume: c[3], symbol: c[4], openPrice: c[5],
    sl: c[6], tp: c[7], closeTime: c[8], closePrice: c[9],
    commission: String(parseNum(c[10]) + parseNum(c[11])), swap: c[12], profit: c[13],
  }
}

/** Báo cáo MT5 có dòng "Account: 12345678 (USD, Server, ...)". */
function reportAccount(rows: string[][]): string | undefined {
  for (const r of rows.slice(0, 15)) {
    const at = r.findIndex((c) => /^account:?$/i.test(c))
    const m = at >= 0 ? r[at + 1]?.match(/^\d{3,}/) : null
    if (m) return m[0]
  }
  return undefined
}

function parseHtml(text: string): ParseResult {
  const rows = htmlRows(text)
  const warnings: string[] = []
  const account = reportAccount(rows)
  for (const [fmt, fn] of [['mt5', mt5Row], ['mt4', mt4Row]] as const) {
    const raws = rows.map(fn).filter((r): r is Raw => r !== null)
    if (raws.length === 0) continue
    const trades = raws
      .map((r) => toTrade(r, fmt))
      .filter((t): t is Trade => t !== null)
      .map((t) => (fmt === 'mt5' && account ? { ...t, id: `mt5:${account}:${t.ticket}`, account } : t))
    if (trades.length < raws.length) warnings.push(`Bỏ qua ${raws.length - trades.length} dòng không đọc được số liệu.`)
    return { trades, format: fmt, warnings }
  }
  return { trades: [], format: 'unknown', warnings: ['Không tìm thấy bảng lệnh đã đóng trong file HTML này.'] }
}

export function splitCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => first.split(ch).length
  const sep = count('\t') > count(';') && count('\t') > count(',') ? '\t' : count(';') > count(',') ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

const CSV_ALIASES: Record<keyof Raw, string[]> = {
  ticket: ['ticket', 'position', 'id', 'order', 'deal'],
  symbol: ['symbol', 'item', 'pair', 'instrument'],
  type: ['type', 'side', 'direction'],
  volume: ['volume', 'size', 'lots', 'lot'],
  openTime: ['opentime', 'timeopen', 'entrytime', 'time'],
  openPrice: ['openprice', 'priceopen', 'entryprice', 'entry', 'price'],
  sl: ['sl', 's/l', 'stoploss'],
  tp: ['tp', 't/p', 'takeprofit'],
  closeTime: ['closetime', 'timeclose', 'exittime', 'time'],
  closePrice: ['closeprice', 'priceclose', 'exitprice', 'exit', 'price'],
  commission: ['commission', 'fee', 'fees'],
  swap: ['swap'],
  profit: ['profit', 'pnl', 'p/l', 'pl'],
}
const REQUIRED: (keyof Raw)[] = ['symbol', 'volume', 'openTime', 'openPrice', 'closeTime', 'closePrice', 'profit']

function parseCsv(text: string): ParseResult {
  const rows = splitCsv(text.replace(/^﻿/, ''))
  if (rows.length < 2) return { trades: [], format: 'unknown', warnings: ['File CSV trống.'] }
  const header = rows[0].map((h) => h.toLowerCase().replace(/[\s_\-.]/g, ''))
  const used = new Set<number>()
  const idx = {} as Record<keyof Raw, number>
  // Ưu tiên tên dài, cụ thể trước ("closetime" trước "time") để không gán nhầm cột.
  for (const key of Object.keys(CSV_ALIASES) as (keyof Raw)[]) {
    idx[key] = -1
    for (const alias of CSV_ALIASES[key]) {
      const at = header.findIndex((h, i) => h === alias && !used.has(i))
      if (at >= 0) { idx[key] = at; used.add(at); break }
    }
  }
  const missing = REQUIRED.filter((k) => idx[k] < 0)
  if (missing.length)
    return { trades: [], format: 'unknown', warnings: [`CSV thiếu cột: ${missing.join(', ')}. Hãy tải file mẫu để xem tên cột.`] }

  const get = (r: string[], k: keyof Raw) => (idx[k] >= 0 ? r[idx[k]] ?? '' : '')
  const body = rows.slice(1)
  const trades = body
    .map((r) => {
      const raw = {} as Raw
      for (const k of Object.keys(CSV_ALIASES) as (keyof Raw)[]) raw[k] = get(r, k)
      return toTrade(raw, 'csv')
    })
    .filter((t): t is Trade => t !== null)
  const warnings = trades.length < body.length ? [`Bỏ qua ${body.length - trades.length} dòng không đọc được.`] : []
  return { trades, format: 'csv', warnings }
}

export function parseReport(text: string): ParseResult {
  return /<\s*(html|table|tr)\b/i.test(text) ? parseHtml(text) : parseCsv(text)
}

export const CSV_TEMPLATE =
  'ticket,symbol,type,volume,open_time,open_price,sl,tp,close_time,close_price,commission,swap,profit\n' +
  '1001,EURUSD,buy,0.10,2026.01.05 09:15:00,1.08500,1.08200,1.09100,2026.01.05 14:40:00,1.09020,-0.70,0,52.00\n'

function csvCell(v: string | number | undefined): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function fmtServerTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

export function toCsv(trades: Trade[]): string {
  const head = 'ticket,symbol,type,volume,open_time,open_price,sl,tp,close_time,close_price,commission,swap,profit,setup,note'
  const lines = trades.map((t) =>
    [t.ticket, t.symbol, t.side, t.volume, fmtServerTime(t.openTime), t.openPrice, t.sl, t.tp,
      fmtServerTime(t.closeTime), t.closePrice, t.commission, t.swap, t.profit, t.setup, t.note].map(csvCell).join(','),
  )
  return [head, ...lines].join('\n') + '\n'
}
