/**
 * Bridge giả lập, chỉ dùng cho bản xem trước (build với VITE_PREVIEW=1).
 * Trả đúng dạng dữ liệu như bridge.py: vài tài khoản, lệnh đang mở, lịch sử, giá, nến, tin Telegram, lịch kinh tế.
 * Mọi thứ nằm trong bộ nhớ của trang; tải lại trang là về như cũ.
 */
import type { AccountInfo } from './accounts'
import type { AccountMeta, AccountType, Candle, LiveAccount, LivePosition, Mt5Deal, Mt5Order, TgMessage } from './bridge'
import type { CalEvent } from './news'
import { demoTrades } from './demo'
import { contractSize, parseSymbol, SAMPLE_QUOTES, usdValue } from './forex'
import { dealsToTrades } from './mt5deals'
import { demoMessages } from './signals'
import { balanceDealsToEntries, type LedgerEntry } from './ledger'

const HOUR = 3_600_000
const OFFSET = 2 // giờ máy chủ giả lập: UTC+2
const T0 = Date.now()

interface Acc { id: string; label: string; type: AccountType; tradable: boolean; currency: string; leverage: number; base: number; scale: number; slice: number; terminal: string; positions: LivePosition[]; connected: boolean }

const accounts: Acc[] = [
  { id: '218551005', label: 'Exness Real', type: 'real', tradable: true, currency: 'USD', leverage: 500, base: 800, scale: 0.05, slice: 0, terminal: 'C:\\Program Files\\MetaTrader 5\\terminal64.exe', positions: [], connected: true },
  { id: '520011', label: 'FTMO 100K', type: 'prop', tradable: false, currency: 'USD', leverage: 100, base: 100000, scale: 2.5, slice: 1, terminal: 'C:\\Program Files\\FTMO MetaTrader 5\\terminal64.exe', positions: [], connected: true },
  { id: '730045', label: 'The5ers 100K', type: 'prop', tradable: false, currency: 'USD', leverage: 100, base: 100000, scale: 2, slice: 2, terminal: 'C:\\Program Files\\The5ers MetaTrader 5\\terminal64.exe', positions: [], connected: true },
  { id: '411902', label: 'Copy trade', type: 'copy', tradable: false, currency: 'USD', leverage: 200, base: 5000, scale: 0.3, slice: 3, terminal: 'C:\\Program Files\\MT5 Copy\\terminal64.exe', positions: [], connected: true },
]
const FREE_TERMINAL = 'C:\\Program Files\\MT5 Moi\\terminal64.exe'

// ---------- giá: dao động chậm quanh giá mẫu, cố định theo thời gian để mọi nơi thấy cùng một giá
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7)
function mid(symbol: string, t = Date.now()): number {
  const info = parseSymbol(symbol)!
  const base = usdValue(info.base, SAMPLE_QUOTES) / usdValue(info.quote, SAMPLE_QUOTES)
  const h = hash(symbol)
  return base * (1 + 0.004 * Math.sin(t / 5_400_000 + h) + 0.0012 * Math.sin(t / 420_000 + h * 3) + 0.0003 * Math.sin(t / 37_000 + h))
}
const digits = (symbol: string) => (symbol.includes('JPY') ? 3 : symbol.startsWith('XA') ? 2 : 5)
const round = (symbol: string, v: number) => Number(v.toFixed(digits(symbol)))
function tick(symbol: string) {
  const m = mid(symbol)
  const spread = symbol.startsWith('XAU') ? 0.25 : symbol.includes('JPY') ? 0.012 : 0.00012
  return { bid: round(symbol, m - spread / 2), ask: round(symbol, m + spread / 2), time: Math.floor(Date.now() / 1000) }
}

function openPos(acc: Acc, ticket: number, symbol: string, side: 'buy' | 'sell', volume: number, hoursAgo: number, slPips: number | null, tpPips: number | null) {
  const pip = symbol.startsWith('XAU') ? 0.1 : symbol.includes('JPY') ? 0.01 : 0.0001
  const open = round(symbol, mid(symbol, Date.now() - hoursAgo * HOUR))
  const dir = side === 'buy' ? 1 : -1
  acc.positions.push({
    ticket, symbol, side, volume, openPrice: open, price: open,
    sl: slPips ? round(symbol, open - dir * slPips * pip) : 0, tp: tpPips ? round(symbol, open + dir * tpPips * pip) : 0,
    profit: 0, swap: 0, time: Math.floor((Date.now() - hoursAgo * HOUR) / 1000) + OFFSET * 3600,
  })
}
openPos(accounts[0], 9001, 'XAUUSD', 'buy', 0.02, 3, 80, 160)
openPos(accounts[1], 9101, 'EURUSD', 'sell', 1.0, 5, 25, 50)
openPos(accounts[3], 9301, 'GBPJPY', 'buy', 0.1, 20, null, null)

function refreshPositions(acc: Acc) {
  for (const p of acc.positions) {
    const t = tick(p.symbol)
    p.price = p.side === 'buy' ? t.bid : t.ask
    const info = parseSymbol(p.symbol)!
    p.profit = Number(((p.price - p.openPrice) * (p.side === 'buy' ? 1 : -1) * contractSize(info) * p.volume * usdValue(info.quote, SAMPLE_QUOTES)).toFixed(2))
  }
}

// ---------- lịch sử: lệnh mẫu chia cho 4 tài khoản, dời theo bội số tuần để giữ đúng thứ trong tuần
const demo = demoTrades()
const WEEK = 7 * 86_400_000
const shift = Math.floor((T0 - HOUR - Math.max(...demo.map((t) => t.closeTime))) / WEEK) * WEEK
function historyOf(acc: Acc): { deals: Mt5Deal[]; orders: Mt5Order[] } {
  const deals: Mt5Deal[] = []
  const orders: Mt5Order[] = []
  const mine = demo.filter((_, i) => i % 4 === acc.slice)
  let ticket = 1
  const first = Math.min(...mine.map((t) => t.openTime)) + shift
  if (acc.type !== 'prop') {
    const dep = acc.type === 'real' ? 1000 : 5000
    deals.push({ ticket: ticket++, positionId: 0, time: Math.floor((first - 3 * 86_400_000) / 1000), type: 2, entry: 0, symbol: '', volume: 0, price: 0, commission: 0, fee: 0, swap: 0, profit: dep })
    if (acc.type === 'real') deals.push({ ticket: ticket++, positionId: 0, time: Math.floor((T0 - 12 * 86_400_000) / 1000), type: 2, entry: 0, symbol: '', volume: 0, price: 0, commission: 0, fee: 0, swap: 0, profit: -200 })
  }
  for (const t of mine) {
    const pos = Number(t.ticket)
    const volume = Math.max(0.01, Math.round(t.volume * acc.scale * 100) / 100)
    const k = volume / t.volume
    const typeIn = t.side === 'buy' ? 0 : 1
    deals.push({ ticket: ticket++, positionId: pos, time: Math.floor((t.openTime + shift) / 1000), type: typeIn, entry: 0, symbol: t.symbol + (acc.type === 'real' ? 'm' : ''), volume, price: t.openPrice, commission: Number((t.commission * k / 2).toFixed(2)), fee: 0, swap: 0, profit: 0 })
    deals.push({ ticket: ticket++, positionId: pos, time: Math.floor((t.closeTime + shift) / 1000), type: 1 - typeIn, entry: 1, symbol: t.symbol + (acc.type === 'real' ? 'm' : ''), volume, price: t.closePrice, commission: Number((t.commission * k / 2).toFixed(2)), fee: 0, swap: Number((t.swap * k).toFixed(2)), profit: Number((t.profit * k).toFixed(2)) })
    orders.push({ positionId: pos, time: Math.floor((t.openTime + shift) / 1000), sl: t.sl, tp: t.tp })
  }
  return { deals, orders }
}
const balances = new Map(accounts.map((a) => {
  const h = historyOf(a)
  const net = h.deals.reduce((s, d) => s + d.profit + d.commission + d.fee + d.swap, 0)
  return [a.id, Number(((a.type === 'prop' ? a.base : 0) + net).toFixed(2))]
}))

function live(acc: Acc): LiveAccount {
  refreshPositions(acc)
  const balance = balances.get(acc.id) ?? acc.base
  const profit = Number(acc.positions.reduce((s, p) => s + p.profit, 0).toFixed(2))
  const margin = Number(acc.positions.reduce((s, p) => {
    const info = parseSymbol(p.symbol)!
    return s + (contractSize(info) * p.volume * usdValue(info.base, SAMPLE_QUOTES)) / acc.leverage
  }, 0).toFixed(2))
  return {
    ...meta(acc), login: Number(acc.id), server: acc.type === 'prop' ? `${acc.label.split(' ')[0]}-Server` : 'Exness-MT5Real29', name: 'Xem trước',
    currency: acc.currency, balance, equity: Number((balance + profit).toFixed(2)), profit, margin, marginFree: Number((balance + profit - margin).toFixed(2)),
    leverage: acc.leverage, positions: acc.positions.map((p) => ({ ...p })),
  }
}
const meta = (a: Acc): AccountMeta => ({ id: a.id, label: a.label, type: a.type, tradable: a.tradable, connected: a.connected, error: a.connected ? '' : 'MT5 từ chối kết nối: (-6, Authorization failed)' })

// ---------- nến: đi ngẫu nhiên có xu hướng, kết thúc tại giá hiện tại
function candles(symbol: string, tf: string, count: number): Candle[] {
  const step = ({ M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800 } as Record<string, number>)[tf] ?? 3600
  const now = Math.floor(Date.now() / 1000) + OFFSET * 3600
  const out: Candle[] = []
  for (let i = count - 1; i >= 0; i--) {
    const tServer = now - (now % step) - i * step
    const tUtc = (tServer - OFFSET * 3600) * 1000
    const o = mid(symbol, tUtc), c = mid(symbol, tUtc + step * 1000)
    const wick = Math.abs(c - o) * 0.6 + o * (step >= 14400 ? 0.0015 : 0.0004)
    out.push({ t: tServer, o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c })
  }
  return out
}

// ---------- tin Telegram và lịch kinh tế
const messages: TgMessage[] = [
  ...demoMessages(T0),
  { channel: 'Tin nhanh FX', id: 101, date: Math.floor(T0 / 1000) - 2400, text: 'Fed giữ nguyên lãi suất; chủ tịch Fed nói cần thêm dữ liệu trước khi cắt giảm. USD tăng nhẹ.' },
  { channel: 'Tin nhanh FX', id: 102, date: Math.floor(T0 / 1000) - 9000, text: 'Giá vàng lập đỉnh tuần trong phiên Á do nhu cầu trú ẩn.' },
  { channel: 'Tin nhanh FX', id: 103, date: Math.floor(T0 / 1000) - 20000, text: 'BoJ phát tín hiệu có thể tăng lãi suất vào tháng tới, JPY mạnh lên.' },
]
const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString()
const calendar: CalEvent[] = [
  { title: 'Retail Sales m/m', currency: 'GBP', date: at(-5), impact: 'High', forecast: '0.3%', previous: '0.4%' },
  { title: 'Core CPI m/m', currency: 'USD', date: at(0.7), impact: 'High', forecast: '0.3%', previous: '0.2%' },
  { title: 'German ZEW Economic Sentiment', currency: 'EUR', date: at(20), impact: 'Medium', forecast: '12.0', previous: '10.3' },
  { title: 'BoJ Policy Rate', currency: 'JPY', date: at(28), impact: 'High', forecast: '0.50%', previous: '0.25%' },
  { title: 'Employment Change', currency: 'AUD', date: at(44), impact: 'High', forecast: '25.0K', previous: '18.2K' },
  { title: 'Unemployment Claims', currency: 'USD', date: at(50), impact: 'Medium', forecast: '221K', previous: '218K' },
  { title: 'Flash Manufacturing PMI', currency: 'EUR', date: at(68), impact: 'Medium', forecast: '46.8', previous: '46.5' },
  { title: 'Bank Holiday', currency: 'CAD', date: at(90), impact: 'Holiday', forecast: '', previous: '' },
]

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const find = (id: unknown) => {
  const a = accounts.find((x) => x.id === String(id))
  if (!a) throw new Error(`Không có tài khoản ${id}`)
  return a
}

export async function mockGet(path: string): Promise<unknown> {
  await wait(120)
  const url = new URL(path, 'http://x')
  const q = (k: string) => url.searchParams.get(k) ?? ''
  const pick = () => (q('account') ? find(q('account')) : accounts[0])
  switch (url.pathname) {
    case '/status': return { accounts: accounts.map(meta), telegram: { connected: true, error: '', channels: [...new Set(messages.map((m) => m.channel))], postTargets: ['Nhóm cộng đồng (xem trước)'] } }
    case '/accounts': return accounts.map((a) => (a.connected ? live(a) : meta(a)))
    case '/history': return historyOf(pick())
    case '/prices': return Object.fromEntries(q('symbols').split(',').filter((s) => parseSymbol(s)).map((s) => [s, tick(s)]))
    case '/candles': return candles(q('symbol'), q('tf') || 'H1', Math.min(Number(q('count')) || 300, 20000))
    case '/telegram/messages': return messages.filter((m) => m.date > Number(q('after') || 0))
    case '/calendar': return calendar
    case '/terminals': {
      const used = new Map(accounts.map((a) => [a.terminal, a.label]))
      return [...accounts.map((a) => a.terminal), FREE_TERMINAL].map((p) => ({ path: p, usedBy: used.get(p) ?? null }))
    }
  }
  throw new Error('Không có đường dẫn này')
}

let nextTicket = 9500
export async function mockPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  await wait(300)
  if (path === '/order') {
    const acc = find(body.account)
    if (!acc.tradable) throw new Error('Tài khoản này chưa bật "allow_trading" trong config.json')
    const symbol = String(body.symbol), side = body.side as 'buy' | 'sell', volume = Number(body.volume), sl = Number(body.sl), tp = Number(body.tp) || 0
    if (!(sl > 0)) throw new Error('Bắt buộc phải có stop loss')
    if (!(volume > 0 && volume <= 1)) throw new Error('Khối lượng phải lớn hơn 0 và không quá max_lot = 1.0')
    const t = tick(symbol)
    const price = side === 'buy' ? t.ask : t.bid
    if (side === 'buy' ? sl >= price : sl <= price) throw new Error(`Stop loss ${sl} nằm sai phía so với giá ${price}`)
    const ticket = nextTicket++
    acc.positions.push({ ticket, symbol, side, volume, openPrice: price, price, sl, tp, profit: 0, swap: 0, time: Math.floor(Date.now() / 1000) + OFFSET * 3600 })
    return { order: ticket, deal: ticket, price, volume }
  }
  if (path === '/close') {
    const acc = find(body.account)
    const p = acc.positions.find((x) => x.ticket === Number(body.ticket))
    if (!p) throw new Error(`Không thấy lệnh đang mở số ${body.ticket}`)
    refreshPositions(acc)
    acc.positions = acc.positions.filter((x) => x !== p)
    balances.set(acc.id, Number(((balances.get(acc.id) ?? 0) + p.profit).toFixed(2)))
    return { order: nextTicket, deal: nextTicket++, price: p.price, volume: p.volume }
  }
  if (path === '/accounts/add') {
    const id = String(body.login)
    if (!/^\d+$/.test(id)) throw new Error('Số tài khoản phải là số')
    if (accounts.some((a) => a.id === id)) throw new Error(`Tài khoản ${id} đã có trong danh sách`)
    const terminal = String(body.terminal_path)
    const owner = accounts.find((a) => a.terminal === terminal)
    if (owner) throw new Error(`Bản MT5 này đang dùng cho "${owner.label}". Mỗi tài khoản cần một bản MT5 riêng`)
    const type = (body.type as AccountType) || 'real'
    accounts.push({ id, label: String(body.label || id), type, tradable: !!body.allow_trading, currency: 'USD', leverage: 100, base: type === 'prop' ? 100000 : 10000, scale: 1, slice: 0, terminal, positions: [], connected: true })
    balances.set(id, type === 'prop' ? 100000 : 10000)
    return { id }
  }
  if (path === '/accounts/remove') {
    const acc = find(body.account)
    accounts.splice(accounts.indexOf(acc), 1)
    return { removed: acc.id }
  }
  if (path === '/telegram/send') return { sent: true, target: body.target }
  throw new Error('Không có đường dẫn này')
}

/** Nạp sẵn dữ liệu cho lần mở đầu tiên: Nhật ký đã đồng bộ, nhãn và nhóm tài khoản, vài khoản thu chi. */
export function seed() {
  const put = (k: string, v: unknown) => { try { if (localStorage.getItem(k) == null) localStorage.setItem(k, JSON.stringify(v)) } catch { /* bộ nhớ bị chặn */ } }
  const trades = accounts.flatMap((a) => { const h = historyOf(a); return dealsToTrades(h.deals, h.orders, a.id) })
  const setups = ['Breakout', 'Pullback', 'Range']
  trades.forEach((t, i) => { t.setup = setups[i % 3] })
  put('fx.trades', trades)
  const info: Record<string, Partial<AccountInfo>> = {
    '218551005': { broker: 'Exness', env: 'real', role: 'own', group: 'Real', note: 'Tài khoản chính' },
    '520011': { broker: 'FTMO', env: 'real', role: 'prop', phase: 'Vòng 1', group: 'Quỹ FTMO', note: 'Mua ngày 01/09' },
    '730045': { broker: 'The5ers', env: 'real', role: 'prop', phase: 'Vòng 2', group: 'Quỹ The5ers' },
    '411902': { broker: 'Exness', env: 'real', role: 'copy', group: 'Copy trade', note: 'Tài khoản cho người khác copy' },
  }
  put('fx.accountInfo', info)
  const day = (d: number) => new Date(T0 - d * 86_400_000).toISOString().slice(0, 10)
  const ledger: LedgerEntry[] = [
    { id: 's1', date: day(80), flow: 'out', category: 'prop_fee', amount: 540, note: 'FTMO 100K' },
    { id: 's2', date: day(75), flow: 'out', category: 'prop_fee', amount: 495, note: 'The5ers High Stakes 100K' },
    { id: 's3', date: day(70), flow: 'out', category: 'tools', amount: 60, note: 'TradingView Plus, 1 tháng' },
    { id: 's4', date: day(40), flow: 'out', category: 'tools', amount: 60, note: 'TradingView Plus, 1 tháng' },
    { id: 's5', date: day(30), flow: 'in', category: 'prop_payout', amount: 1850, note: 'Payout lần 1' },
    { id: 's6', date: day(10), flow: 'in', category: 'backcom', amount: 132, note: 'Backcom tháng 10' },
    { id: 's7', date: day(6), flow: 'in', category: 'affiliate', amount: 90, note: 'Hoa hồng giới thiệu' },
  ]
  // Các lần nạp/rút của tài khoản riêng, cùng id với nút "Lấy nạp/rút từ MT5" nên bấm lại không bị trùng.
  for (const a of accounts.filter((x) => x.type !== 'prop')) ledger.push(...balanceDealsToEntries(historyOf(a).deals, a.id, a.label))
  put('fx.ledger', ledger)
}
