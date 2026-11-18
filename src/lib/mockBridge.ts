import { DEFAULT_WATCH, isWatched, newsKey, type ActiveNews, type NewsWatchConfig } from './newsWatch'
import { BLANK_PERSONA, DUCK_PERSONA, PERSONA_TEMPLATES, type ChatTurn, type Persona, type PersonaStore } from './persona'
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
import { digitsOf, type MarketFeatures } from './features'
import { TEMPLATES, type Analysis, type Playbook } from './kb'

const HOUR = 3_600_000
const OFFSET = 2 // giờ máy chủ giả lập: UTC+2
const T0 = Date.now()

interface Acc { id: string; label: string; type: AccountType; tradable: boolean; currency: string; leverage: number; base: number; scale: number; slice: number; terminal: string; positions: LivePosition[]; connected: boolean }

const accounts: Acc[] = [
  { id: '218551005', label: 'Exness Real', type: 'real', tradable: true, currency: 'USD', leverage: 500, base: 800, scale: 0.05, slice: 0, terminal: 'C:\\Program Files\\MetaTrader 5\\terminal64.exe', positions: [], connected: true },
  { id: '520011', label: 'FTMO 100K', type: 'prop', tradable: false, currency: 'USD', leverage: 100, base: 100000, scale: 2.5, slice: 1, terminal: 'C:\\Program Files\\FTMO MetaTrader 5\\terminal64.exe', positions: [], connected: true },
  { id: '730045', label: 'The5ers 100K', type: 'prop', tradable: false, currency: 'USD', leverage: 100, base: 100000, scale: 2, slice: 2, terminal: 'C:\\Program Files\\The5ers MetaTrader 5\\terminal64.exe', positions: [], connected: true },
  { id: '411902', label: 'Copy trade', type: 'copy', tradable: false, currency: 'USD', leverage: 200, base: 5000, scale: 0.3, slice: 3, terminal: 'C:\\Program Files\\MT5 Copy\\terminal64.exe', positions: [], connected: true },
  { id: '88120347', label: 'Anh Nam (Exness)', type: 'view', tradable: false, currency: 'USD', leverage: 500, base: 3000, scale: 0.4, slice: 1, terminal: 'C:\\Program Files\\MT5 View 1\\terminal64.exe', positions: [], connected: true },
  { id: '77019234', label: 'Chị Lan (vàng)', type: 'view', tradable: false, currency: 'USD', leverage: 200, base: 10000, scale: 0.8, slice: 3, terminal: 'C:\\Program Files\\MT5 View 2\\terminal64.exe', positions: [], connected: true },
]
const FREE_TERMINAL = 'C:\\Program Files\\MT5 Moi\\terminal64.exe'

// ---------- giá: dao động chậm quanh giá mẫu, cố định theo thời gian để mọi nơi thấy cùng một giá
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7)
function mid(symbol: string, t = Date.now()): number {
  const info = parseSymbol(symbol)!
  const base = usdValue(info.base, SAMPLE_QUOTES) / usdValue(info.quote, SAMPLE_QUOTES)
  const h = hash(symbol)
  // Xu hướng chậm theo từng cặp (vàng tăng, EURUSD giảm…) để phân tích mẫu có cái để thấy.
  const drift = ({ XAUUSD: 0.06, EURUSD: -0.03, GBPJPY: 0.025, USDJPY: 0.02, AUDUSD: -0.02 } as Record<string, number>)[symbol] ?? 0
  return base * (1 + drift * ((t - T0) / (30 * 86_400_000)) + 0.004 * Math.sin(t / 5_400_000 + h) + 0.0012 * Math.sin(t / 420_000 + h * 3) + 0.0003 * Math.sin(t / 37_000 + h))
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
openPos(accounts[4], 9401, 'XAUUSD', 'sell', 0.3, 2, 60, 120)
openPos(accounts[5], 9501, 'XAUUSD', 'buy', 0.5, 1, 50, 150)
openPos(accounts[5], 9502, 'EURUSD', 'buy', 0.8, 6, 20, 40)

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

// ---------- AI: khoá, model theo tính năng, chi phí mẫu 7 ngày
const AI_FEATURES = { chat: 'Golden Duck Talk', learn: 'AI học trade', analyze: 'AI phân tích', rate: 'Đánh giá tài khoản' }
let aiKey = 'sk-ant-xemtruoc-1234'
const aiModels: Record<string, string> = { chat: 'claude-opus-5-5', learn: 'claude-opus-5-5', analyze: 'claude-opus-5-5', rate: 'claude-opus-5-5' }
const aiStatus = () => ({
  configured: !!aiKey, model: 'claude-opus-5-5', key_hint: `…${aiKey.slice(-4)}`, models: aiModels, features: AI_FEATURES,
  choices: [{ id: 'claude-opus-5-5', name: 'Opus 5.5 (thông minh nhất)', in: 4, out: 20 }, { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5 (cân bằng)', in: 2, out: 10 }, { id: 'claude-haiku-5-5', name: 'Haiku 5.5 (rẻ nhất)', in: 0.1, out: 0.5 }],
})
const aiUsage: Record<string, Record<string, { calls: number; input: number; output: number; cache_read: number; cache_write: number; cost: number }>> = Object.fromEntries(
  Array.from({ length: 7 }, (_, i) => [new Date(T0 - i * 86_400_000).toISOString().slice(0, 10), {
    chat: { calls: 20 + i * 3, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: (20 + i * 3) * 0.0006 },
    ...(i % 2 ? {} : { rate: { calls: 1, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0.12 } }),
    ...(i % 3 ? {} : { analyze: { calls: 2, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0.11 } }),
  }]))

// ---------- bot Telegram (giả lập): dán token bất kỳ đúng dạng, 6 giây sau coi như đã bấm Start
const bot = { token: '', linked: false, chat_name: '', since: 0 }
const botStatus = () => ({ configured: !!bot.token, username: bot.token ? 'GoldenDuckCuaBanBot' : '', linked: bot.linked, chat_name: bot.chat_name, code: bot.token ? 'a1b2c3d4' : '', link: bot.token ? 'https://t.me/GoldenDuckCuaBanBot?start=a1b2c3d4' : '', error: '' })

// ---------- cảnh báo tin (giả lập giống bridge): bật sẵn cho tin mạnh của USD, báo trước 60 phút, nhắc lại mỗi 1 phút
let newsWatch: NewsWatchConfig = { ...DEFAULT_WATCH, currencies: ['USD'], lead_min: 60, repeat_min: 1 }
const newsAcks = new Set<string>()
const newsActive: Record<string, ActiveNews> = {}
function newsTick() {
  if (!newsWatch.enabled) return
  for (const e of calendar) {
    const key = newsKey(e)
    if (!isWatched(e, newsWatch) || newsAcks.has(key)) continue
    const t = Date.parse(e.date), left = t - Date.now()
    if (left < 0) { delete newsActive[key]; continue }
    if (left > newsWatch.lead_min * 60_000) continue
    const st = newsActive[key]
    if (!st || (newsWatch.repeat_min > 0 && Date.now() - st.last >= newsWatch.repeat_min * 60_000)) {
      newsActive[key] = { key, at: t, title: e.title, currency: e.currency, impact: e.impact, count: (st?.count ?? 0) + 1, last: Date.now() }
      auto.events.unshift({ at: Date.now(), kind: 'news', account: '', label: 'Hệ thống', text: `🔔 ${e.currency} · ${e.title} (còn ${Math.floor(left / 60_000)} phút)${st ? ` · nhắc lần ${st.count + 1}` : ''}` })
    }
  }
}
const newsSnapshot = () => ({ config: newsWatch, active: Object.values(newsActive).filter((a) => !newsAcks.has(a.key)).sort((a, b) => a.at - b.at), acks: [...newsAcks], telegram: true })

// ---------- kho kiến thức mẫu
const playbooks: Playbook[] = [{
  id: 'pb-demo', name: 'ICT + SMC của tôi (mẫu)', rules: TEMPLATES.find((t) => t.id === 'ict')!.rules,
  sources: [
    { id: 's1', name: 'ICT 2022 Mentorship - ghi chép.pdf', kind: 'pdf', size: 2_480_000, addedAt: T0 - 5 * 86_400_000 },
    { id: 's2', name: 'Bài 4 - Liquidity sweep.srt', kind: 'transcript', size: 38_000, addedAt: T0 - 3 * 86_400_000 },
  ],
  chat: [
    { role: 'user', text: 'Tôi chỉ vào lệnh khi H4 cùng chiều và M15 có CHoCH sau khi quét đáy phiên Á.', at: T0 - 2 * 86_400_000 },
    { role: 'assistant', text: 'Đã ghi vào mục Điều kiện vào lệnh: quét thanh khoản phiên Á, sau đó CHoCH M15 cùng chiều H4.\n\nCâu hỏi cần bạn xác nhận:\n- Bạn có vào lệnh ở phiên Mỹ không, hay chỉ phiên Âu?', at: T0 - 2 * 86_400_000 + 60_000 },
  ],
  updatedAt: T0 - 2 * 86_400_000,
}]
const findPb = (id: unknown) => {
  const pb = playbooks.find((p) => p.id === String(id))
  if (!pb) throw new Error('Không có bộ kiến thức này')
  return pb
}

/** Phân tích mẫu: áp một phiên bản đơn giản của bộ quy tắc ICT lên đặc điểm giá, không gọi AI. */
function mockAnalysis(f: MarketFeatures): Analysis {
  const tf = (name: string) => f.timeframes.find((t) => t.tf === name)!
  const h4 = tf('H4'), m15 = tf('M15'), d1 = tf('D1'), h1 = tf('H1')
  const bias = (t: typeof h4) => (t.structure === 'bullish' || (t.structure === 'mixed' && t.ema_trend === 'up') ? 'up' : t.structure === 'bearish' || (t.structure === 'mixed' && t.ema_trend === 'down') ? 'down' : 'range') as Analysis['main_trend']
  const main = bias(h4)
  const lastBreak = m15.breaks[m15.breaks.length - 1]
  const choch = !!lastBreak && lastBreak.kind === 'CHoCH' && lastBreak.dir === (main === 'up' ? 'up' : 'down')
  const swept = main === 'up' ? f.levels.asia_low != null && Math.min(...m15.swings.filter((s) => s.kind === 'low').map((s) => s.price)) <= f.levels.asia_low
    : f.levels.asia_high != null && Math.max(...m15.swings.filter((s) => s.kind === 'high').map((s) => s.price)) >= f.levels.asia_high
  const zone = [...m15.fvg, ...m15.order_blocks].filter((z) => z.dir === (main === 'up' ? 'bull' : 'bear')).pop()
  const inDiscount = h4.range ? (main === 'up' ? h4.range.position_pct < 50 : h4.range.position_pct > 50) : false
  const checklist = [
    { rule: 'H4 có thiên hướng rõ ràng', met: main !== 'range', detail: `Cấu trúc H4: ${h4.structure}, EMA: ${h4.ema_trend ?? 'không đủ dữ liệu'}` },
    { rule: main === 'down' ? 'Giá ở vùng premium của biên H4 (tăng độ tin cậy)' : 'Giá ở vùng discount của biên H4 (tăng độ tin cậy)', met: inDiscount, detail: h4.range ? `Giá ở ${h4.range.position_pct}% biên ${h4.range.low} – ${h4.range.high}` : 'Chưa xác định được biên' },
    { rule: 'Quét thanh khoản phiên Á (tăng độ tin cậy)', met: swept, detail: main === 'down' ? `Đỉnh phiên Á ${f.levels.asia_high ?? '–'}` : `Đáy phiên Á ${f.levels.asia_low ?? '–'}` },
    { rule: 'M15 có CHoCH cùng chiều H4 (tăng độ tin cậy)', met: choch, detail: lastBreak ? `Phá cấu trúc gần nhất: ${lastBreak.kind} ${lastBreak.dir === 'up' ? 'tăng' : 'giảm'} tại ${lastBreak.level}` : 'Chưa có' },
    { rule: 'Có FVG hoặc order block M15 để đặt lệnh limit', met: !!zone, detail: zone ? `${zone.dir === 'bull' ? 'Vùng tăng' : 'Vùng giảm'} ${zone.bottom} – ${zone.top}` : 'Chưa có vùng phù hợp' },
  ]
  const atr = m15.atr || h1.atr / 4
  const r = (v: number) => Number(v.toFixed(digitsOf(f.symbol)))
  let trade: Analysis['trade'] = { side: 'none', order_type: 'none', entry: null, sl: null, tp1: null, tp2: null, rr: null, confidence: 'low', invalidation: '' }
  const ready = main !== 'range' && !!zone
  if (ready && zone) {
    const up = main === 'up'
    const entry = up ? zone.top : zone.bottom
    const sl = up ? zone.bottom - atr * 0.5 : zone.top + atr * 0.5
    const targets = (up ? [...h1.swings.filter((s) => s.kind === 'high').map((s) => s.price), f.levels.prev_day_high] : [...h1.swings.filter((s) => s.kind === 'low').map((s) => s.price), f.levels.prev_day_low])
      .filter((x): x is number => x != null && (up ? x > entry : x < entry)).sort((a, b) => (up ? a - b : b - a))
    const risk = Math.abs(entry - sl)
    const far = targets.filter((x) => Math.abs(x - entry) >= risk * 2)
    const tp1 = far[0] ?? (up ? entry + risk * 2 : entry - risk * 2)
    targets.splice(0, targets.length, ...far.slice(1))
    targets.unshift(tp1)
    const rr = Math.abs(tp1 - entry) / Math.abs(entry - sl)
    trade = { side: up ? 'buy' : 'sell', order_type: 'limit', entry: r(entry), sl: r(sl), tp1: r(tp1), tp2: targets[1] != null ? r(targets[1]) : null, rr: Number(rr.toFixed(2)), confidence: checklist.every((c) => c.met) ? 'high' : checklist.filter((c) => c.met).length >= 3 ? 'medium' : 'low', invalidation: `Nến H1 đóng cửa ${up ? 'dưới' : 'trên'} ${r(sl)}` }
  }
  const hasTrade = trade.side !== 'none' && (trade.rr ?? 0) >= 1.5
  return {
    main_trend: main,
    summary: `(Phân tích mẫu, không phải AI thật) D1 ${bias(d1) === 'up' ? 'tăng' : bias(d1) === 'down' ? 'giảm' : 'đi ngang'}, H4 ${main === 'up' ? 'tăng' : main === 'down' ? 'giảm' : 'đi ngang'}. ${hasTrade ? 'Đủ hai điều kiện bắt buộc (thiên hướng H4 và vùng vào lệnh M15); các điều kiện còn lại quyết định độ tin cậy.' : 'Chưa đủ điều kiện bắt buộc.'}`,
    timeframes: [d1, h4, h1, m15].map((t) => ({ tf: t.tf, bias: bias(t), note: `${t.structure === 'bullish' ? 'HH-HL' : t.structure === 'bearish' ? 'LH-LL' : 'Lẫn lộn'}${t.breaks.length ? `, ${t.breaks[t.breaks.length - 1].kind} ${t.breaks[t.breaks.length - 1].dir === 'up' ? 'tăng' : 'giảm'}` : ''}` })),
    key_levels: [
      ...(f.levels.prev_day_high != null ? [{ price: f.levels.prev_day_high, label: 'Đỉnh ngày trước' }] : []),
      ...(f.levels.prev_day_low != null ? [{ price: f.levels.prev_day_low, label: 'Đáy ngày trước' }] : []),
      ...(f.levels.asia_high != null ? [{ price: f.levels.asia_high, label: 'Đỉnh phiên Á' }] : []),
      ...(f.levels.asia_low != null ? [{ price: f.levels.asia_low, label: 'Đáy phiên Á' }] : []),
      ...(zone ? [{ price: zone.top, label: 'Cạnh trên vùng vào lệnh M15' }, { price: zone.bottom, label: 'Cạnh dưới vùng vào lệnh M15' }] : []),
    ],
    checklist,
    has_trade: hasTrade,
    trade: hasTrade ? trade : { ...trade, side: 'none', order_type: 'none', entry: null, sl: null, tp1: null, tp2: null, rr: null },
    wait_for: hasTrade ? '' : checklist.filter((c) => !c.met).map((c) => c.rule).join('; ') || 'R:R tới TP1 đạt từ 1:2',
  }
}

// ---------- tự động hoá giả lập (bảo vệ, cảnh báo, copy lệnh)
import type { AutoEvent, AutomationSnapshot, CopierConfig, GuardConfig, GuardStops } from './automation'
const auto = {
  guards: {} as Record<string, GuardConfig>,
  locks: {} as AutomationSnapshot['locks'],
  events: [
    { at: T0 - 3 * HOUR, kind: 'news', account: '', label: 'Hệ thống', text: 'Còn 25 phút nữa có tin mạnh USD: Core CPI m/m. Bạn đang có lệnh mở với USD.' },
  ] as AutoEvent[],
  alerts: { news: true, minutes: 30, notify: true },
  copier: { enabled: false, master: '', followers: [], copy_sltp: true } as CopierConfig,
}
// Lỗ đã chốt hôm nay của từng tài khoản (giả lập), để thanh "đã dùng" có số.
const stopsSeen: Record<string, string> = {}
const closedToday: Record<string, number> = { '520011': -1450, '730045': -320, '218551005': -6.4, '411902': 0 }
function autoSnapshot(): AutomationSnapshot {
  const states: AutomationSnapshot['states'] = {}
  for (const a of accounts) {
    const g = auto.guards[a.id]
    if (!g) continue
    const l = live(a)
    const dayLoss = Math.max(0, -((closedToday[a.id] ?? 0) + l.profit))
    const used = g.daily_limit > 0 ? dayLoss / g.daily_limit : 0
    const floorUsed = g.floor > 0 && g.max_loss > 0 ? Math.max(0, (g.max_loss - (l.equity - g.floor)) / g.max_loss) : 0
    const level = Math.max(used, floorUsed)
    const dayProfit = Math.max(0, (closedToday[a.id] ?? 0) + l.profit)
    if (g.enabled && g.profit_limit && dayProfit >= g.profit_limit && !auto.locks[a.id]) {
      const until = Math.floor(T0 / 1000) + 12 * 3600
      auto.locks[a.id] = { until, reason: `Đạt mục tiêu lãi ngày (+${dayProfit.toFixed(2)} ${a.currency})`, at: Date.now() / 1000, kind: 'limit', unlock_at: g.hard_lock ? until : 0 }
      auto.events.unshift({ at: Date.now(), kind: 'lock', account: a.id, label: a.label, text: `${auto.locks[a.id].reason}. Khoá vào lệnh tới hết ngày máy chủ. Đã đóng ${a.positions.length} lệnh.` })
      a.positions = []
    }
    if (g.enabled && level >= g.act_at && !auto.locks[a.id]) {
      const until = Math.floor(T0 / 1000) + 12 * 3600
      auto.locks[a.id] = { until, reason: `Chạm ${Math.round(level * 100)}% giới hạn lỗ trong ngày`, at: Date.now() / 1000, kind: 'limit', unlock_at: g.hard_lock ? until : 0 }
      auto.events.unshift({ at: Date.now(), kind: 'lock', account: a.id, label: a.label, text: `${auto.locks[a.id].reason}. Khoá vào lệnh tới hết ngày máy chủ.${g.hard_lock ? ' Khoá cứng: không mở tay được.' : ''} Đã đóng ${a.positions.length} lệnh.` })
      a.positions = []
    }
    let stops: GuardStops | undefined
    if (g.hard_stop && a.tradable && a.positions.length && level < g.act_at) {
      const budget = Math.max(0, Math.min(g.daily_limit > 0 ? g.act_at * g.daily_limit + (closedToday[a.id] ?? 0) : Infinity, g.floor > 0 ? l.balance - g.floor - (1 - g.act_at) * g.max_loss : Infinity))
      const key = a.positions.map((p) => p.ticket).join(',')
      if (stopsSeen[a.id] !== key) {
        stopsSeen[a.id] = key
        const bare = a.positions.filter((p) => !p.sl)
        if (bare.length) auto.events.unshift({ at: Date.now(), kind: 'stop', account: a.id, label: a.label, text: `SL khẩn cấp trên sàn (tổng lỗ tối đa ${budget.toFixed(2)} ${a.currency} nếu mọi lệnh chạm SL): gắn SL cho ${bare.map((p) => `${p.symbol} #${p.ticket}`).join(', ')}.` })
      }
      stops = { on: true, protected: a.positions.length, over: [], budget: Number(budget.toFixed(2)), at: Date.now() }
    }
    states[a.id] = { stops, ref_ok: true, day_profit: Number(dayProfit.toFixed(2)), profit_used: g.profit_limit ? dayProfit / g.profit_limit : 0, day_loss: Number(dayLoss.toFixed(2)), used, floor_used: floorUsed, level, equity: l.equity, currency: a.currency, consec_losses: a.id === '520011' ? 2 : 0, trades: a.id === '520011' ? 3 : 1, positions: a.positions.length, tradable: a.tradable, error: '', updated: Date.now() }
  }
  return { guards: auto.guards, states, locks: auto.locks, events: auto.events.slice(0, 100), alerts: auto.alerts, copier: auto.copier, copyState: { started: 0, last: Date.now(), error: '' }, telegram: true }
}

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
    case '/history': {
      // Như bridge thật: chỉ lấy deal trong N ngày gần nhất (giờ máy chủ).
      const h = historyOf(pick()), days = Number(q('days')) || 90
      const from = (Date.now() + OFFSET * HOUR - days * 86_400_000) / 1000
      return { deals: h.deals.filter((d) => d.time >= from), orders: h.orders }
    }
    case '/prices': return Object.fromEntries(q('symbols').split(',').filter((s) => parseSymbol(s)).map((s) => [s, tick(s)]))
    case '/candles': return candles(q('symbol'), q('tf') || 'H1', Math.min(Number(q('count')) || 300, 20000))
    case '/telegram/messages': return messages.filter((m) => m.date > Number(q('after') || 0))
    case '/calendar': return calendar
    case '/news/watch': newsTick(); return newsSnapshot()
    case '/tgbot': { if (bot.token && !bot.linked && Date.now() - bot.since > 6000) { bot.linked = true; bot.chat_name = 'Bạn (xem trước)' } return botStatus() }
    case '/kb': return JSON.parse(JSON.stringify(playbooks))
    case '/automation': return autoSnapshot()
    case '/personas': return personaStore()
    case '/ai/status': return aiStatus()
    case '/ai/usage': return { days: aiUsage, features: AI_FEATURES }
    case '/terminals': {
      const used = new Map(accounts.map((a) => [a.terminal, a.label]))
      return [...accounts.map((a) => a.terminal), FREE_TERMINAL].map((p) => ({ path: p, usedBy: used.get(p) ?? null }))
    }
  }
  throw new Error('Không có đường dẫn này')
}

// ---- trò chuyện AI (xem trước: trả lời soạn sẵn, không gọi AI) ----
const personas: Persona[] = [{ id: 'p1', ...PERSONA_TEMPLATES[0].p, playbooks: ['pb-demo'], createdAt: Date.now(), updatedAt: Date.now() }, { id: 'p2', ...DUCK_PERSONA, createdAt: Date.now(), updatedAt: Date.now() }]
const chats: Record<string, ChatTurn[]> = { p1: [
  { role: 'user', text: 'Thầy ơi hôm qua em thua 3 lệnh vàng liền, giờ muốn vào lot gấp đôi để gỡ.', at: Date.now() - 3600_000 },
  { role: 'assistant', text: 'Dừng tay đã em. Gấp đôi lot sau 3 lệnh thua là cách nhanh nhất để biến một ngày xấu thành một tháng xấu.\n\nThầy thấy trong nhật ký, 30 ngày qua em có chuỗi thua dài nhất 5 lệnh, và mấy lệnh vào vội sau khi thua đều lỗ nặng hơn lệnh thường. Hôm nay em nghỉ, tối nay ngồi xem lại 3 lệnh đó: có lệnh nào đúng kế hoạch không? Kể thầy nghe lệnh đầu tiên.', at: Date.now() - 3590_000 },
] }
const personaStore = () => JSON.parse(JSON.stringify({ items: personas, chats })) as PersonaStore
const CANNED = [
  'Câu hỏi hay. Trước khi trả lời, em cho thầy biết: lệnh này nằm trong kế hoạch nào, điểm vô hiệu ở đâu?',
  'Bản xem trước nên thầy chỉ trả lời mẫu thôi. Khi chạy thật, nhân vật sẽ trả lời theo đúng tính cách, giá trị và kiến thức bạn đã dạy.',
  'Nhớ nhé: giữ rủi ro mỗi lệnh dưới 1% thì một chuỗi thua cũng không giết được tài khoản.',
]

let nextTicket = 9500
export async function mockPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  await wait(300)
  if (path === '/order') {
    const acc = find(body.account)
    if (auto.locks[acc.id]) throw new Error(`Tài khoản đang bị khoá vào lệnh: ${auto.locks[acc.id].reason}`)
    if (!acc.tradable) throw new Error('Tài khoản này chưa bật "allow_trading" trong config.json')
    const symbol = String(body.symbol), side = body.side as 'buy' | 'sell', volume = Number(body.volume), sl = Number(body.sl), tp = Number(body.tp) || 0
    if (!(sl > 0)) throw new Error('Bắt buộc phải có stop loss')
    if (!(volume > 0 && volume <= 1)) throw new Error('Khối lượng phải lớn hơn 0 và không quá max_lot = 1.0')
    const t = tick(symbol)
    const price = side === 'buy' ? t.ask : t.bid
    if (side === 'buy' ? sl >= price : sl <= price) throw new Error(`Stop loss ${sl} nằm sai phía so với giá ${price}`)
    const ticket = nextTicket++
    acc.positions.push({ ticket, symbol, side, volume, openPrice: price, price, sl, tp, profit: 0, swap: 0, time: Math.floor(Date.now() / 1000) + OFFSET * 3600 })
    // Copy lệnh giả lập: chép ngay sang các tài khoản nhận.
    if (auto.copier.enabled && auto.copier.master === acc.id) {
      for (const f of auto.copier.followers) {
        const fa = accounts.find((x) => x.id === f.account)
        if (!fa || auto.locks[fa.id]) continue
        const vol = Math.max(0.01, Math.round((f.mode === 'fixed' ? f.value : f.mode === 'balance' ? volume * ((balances.get(fa.id) ?? 1) / (balances.get(acc.id) ?? 1)) * f.value : volume * f.value) * 100) / 100)
        const fside = f.reverse ? (side === 'buy' ? 'sell' : 'buy') : side
        fa.positions.push({ ticket: nextTicket++, symbol, side: fside, volume: vol, openPrice: price, price, sl: f.reverse ? tp : sl, tp: f.reverse ? sl : tp, profit: 0, swap: 0, time: Math.floor(Date.now() / 1000) + OFFSET * 3600, comment: `FXD#${ticket}` } as LivePosition)
        auto.events.unshift({ at: Date.now(), kind: 'copy', account: fa.id, label: fa.label, text: `Chép ${fside.toUpperCase()} ${vol} lot ${symbol} từ lệnh #${ticket}.` })
      }
    }
    return { order: ticket, deal: ticket, price, volume }
  }
  if (path === '/close') {
    const acc = find(body.account)
    const p = acc.positions.find((x) => x.ticket === Number(body.ticket))
    if (!p) throw new Error(`Không thấy lệnh đang mở số ${body.ticket}`)
    refreshPositions(acc)
    acc.positions = acc.positions.filter((x) => x !== p)
    if (auto.copier.enabled && auto.copier.master === acc.id) {
      for (const fa of accounts) {
        const linked = fa.positions.filter((x) => (x as LivePosition & { comment?: string }).comment === `FXD#${p.ticket}`)
        if (!linked.length) continue
        fa.positions = fa.positions.filter((x) => !linked.includes(x))
        auto.events.unshift({ at: Date.now(), kind: 'copy', account: fa.id, label: fa.label, text: `Đóng ${p.symbol} theo lệnh nguồn #${p.ticket}.` })
      }
    }
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
    accounts.push({ id, label: String(body.label || id), type, tradable: !!body.allow_trading && type !== 'view', currency: 'USD', leverage: 100, base: type === 'prop' ? 100000 : 10000, scale: 1, slice: 0, terminal, positions: [], connected: true })
    balances.set(id, type === 'prop' ? 100000 : 10000)
    return { id }
  }
  if (path === '/accounts/remove') {
    const acc = find(body.account)
    accounts.splice(accounts.indexOf(acc), 1)
    return { removed: acc.id }
  }
  if (path === '/personas/save') {
    const old = personas.find((x) => x.id === body.id)
    const p = { ...BLANK_PERSONA, ...(old ?? {}), ...(body as Partial<Persona>), updatedAt: Date.now() } as Persona
    if (old) personas[personas.indexOf(old)] = p; else { p.id = `p${Date.now()}`; p.createdAt = Date.now(); personas.push(p) }
    return personaStore()
  }
  if (path === '/personas/delete') { const k = personas.findIndex((x) => x.id === body.id); if (k >= 0) personas.splice(k, 1); delete chats[String(body.id)]; return personaStore() }
  if (path === '/chat/clear') { chats[String(body.persona)] = []; return personaStore() }
  if (path === '/chat') {
    await wait(900)
    const id = String(body.persona); const c = (chats[id] ??= [])
    c.push({ role: 'user', text: String(body.message), at: Date.now() })
    const reply = CANNED[c.length % CANNED.length]
    c.push({ role: 'assistant', text: reply, at: Date.now() })
    return { reply, ...personaStore() }
  }
  if (path === '/telegram/send') return { sent: true, target: body.target }
  if (path === '/automation/guard') {
    const id = String(body.account)
    const lk = auto.locks[id]
    if (lk?.unlock_at && lk.unlock_at > Date.now() / 1000 && (!body.config || !(body.config as GuardConfig).enabled)) throw new Error('Đang khoá cứng: không tắt được bảo vệ cho tới khi hết khoá.')
    if (body.config) {
      const g = body.config as GuardConfig
      const was = auto.guards[id]?.enabled
      auto.guards[id] = g
      if (g.enabled && !was) auto.events.unshift({ at: Date.now(), kind: 'warn', account: id, label: find(id).label, text: `Bật bảo vệ: lỗ ngày tối đa ${g.daily_limit.toFixed(2)}, hành động ở ${Math.round(g.act_at * 100)}%.` })
    } else delete auto.guards[id]
    return autoSnapshot()
  }
  if (path === '/ai/key') { await wait(700); if (!String(body.key).startsWith('sk-ant-')) throw new Error('Khoá API của Anthropic bắt đầu bằng sk-ant-. Tạo ở console.anthropic.com → API Keys'); aiKey = String(body.key); return aiStatus() }
  if (path === '/ai/models') { Object.assign(aiModels, body.models as Record<string, string>); return aiStatus() }
  if (path === '/tgbot/token') { await wait(600); if (!/^\d+:[\w-]{10,}$/.test(String(body.token))) throw new Error('Token không đúng dạng. Token có dạng 123456789:AA... do @BotFather gửi'); Object.assign(bot, { token: String(body.token), linked: false, since: Date.now() }); return botStatus() }
  if (path === '/tgbot/unlink') { Object.assign(bot, { linked: false, chat_name: '', since: Date.now() }); return botStatus() }
  if (path === '/tgbot/remove') { Object.assign(bot, { token: '', linked: false, chat_name: '' }); return botStatus() }
  if (path === '/tgbot/test') { if (!bot.linked) throw new Error('Bot chưa nối'); return { sent: true } }
  if (path === '/news/watch') { newsWatch = { ...newsWatch, ...(body.config as NewsWatchConfig) }; newsTick(); return newsSnapshot() }
  if (path === '/news/ack') { for (const k of body.all ? Object.keys(newsActive) : [String(body.key)]) { newsAcks.add(k); delete newsActive[k] } return newsSnapshot() }
  if (path === '/automation/unlock') { const id = String(body.account); const lk = auto.locks[id]; if (lk?.unlock_at && lk.unlock_at > Date.now() / 1000) throw new Error(lk.unlock_at >= lk.until ? 'Khoá cứng vì chạm giới hạn lỗ: tự mở lúc hết ngày máy chủ, không mở tay được.' : 'Khoá cứng: chưa hết 30 phút chờ.'); delete auto.locks[id]; auto.events.unshift({ at: Date.now(), kind: 'unlock', account: id, label: find(id).label, text: 'Đã mở khoá bằng tay.' }); closedToday[id] = 0; return autoSnapshot() }
  if (path === '/automation/alerts') { auto.alerts = { news: !!body.news, minutes: Number(body.minutes) || 30, notify: !!body.notify }; return autoSnapshot() }
  if (path === '/automation/copier') {
    const c = body.config as CopierConfig
    if (c.master && c.followers.some((f) => f.account === c.master)) throw new Error('Tài khoản nguồn không thể đồng thời là tài khoản nhận')
    if (c.enabled && !auto.copier.enabled) auto.events.unshift({ at: Date.now(), kind: 'copy', account: c.master, label: find(c.master).label, text: `Bật copy lệnh sang ${c.followers.length} tài khoản. Bỏ qua ${find(c.master).positions.length} lệnh đang mở sẵn.` })
    auto.copier = { ...c, enabled: c.enabled && !!c.master && c.followers.length > 0 }
    return autoSnapshot()
  }
  if (path === '/automation/test') return { sent: true }
  if (path === '/kb/save') {
    if (body.id) {
      const pb = findPb(body.id)
      if (body.name) pb.name = String(body.name)
      if ('rules' in body) pb.rules = String(body.rules)
      pb.updatedAt = Date.now()
      return { ...pb }
    }
    if (!String(body.name || '').trim()) throw new Error('Cần đặt tên cho bộ kiến thức')
    const pb: Playbook = { id: `pb-${Date.now()}`, name: String(body.name), rules: String(body.rules || ''), sources: [], chat: [], updatedAt: Date.now() }
    playbooks.push(pb)
    return { ...pb }
  }
  if (path === '/kb/delete') { playbooks.splice(playbooks.indexOf(findPb(body.id)), 1); return { deleted: body.id } }
  if (path === '/kb/source') {
    const pb = findPb(body.playbook)
    const size = body.kind === 'pdf' ? Math.round(String(body.data || '').length * 0.75) : String(body.text || '').length
    pb.sources.push({ id: `s${Date.now()}`, name: String(body.name || 'Tài liệu'), kind: body.kind as 'pdf' | 'text' | 'transcript', size, addedAt: Date.now() })
    return JSON.parse(JSON.stringify(pb))
  }
  if (path === '/kb/source/delete') { const pb = findPb(body.playbook); pb.sources = pb.sources.filter((s) => s.id !== body.source); return JSON.parse(JSON.stringify(pb)) }
  if (path === '/kb/learn') {
    await wait(900)
    const pb = findPb(body.playbook)
    const text = String(body.message || '').trim()
    if (!text) throw new Error('Tin nhắn đang trống')
    const summarize = text.startsWith('Hãy đọc toàn bộ tài liệu')
    const reply = summarize
      ? `(Câu trả lời mẫu, bản xem trước không gọi AI.) Đã đọc ${pb.sources.length} tài liệu và tổng hợp lại bộ quy tắc.\n\nCâu hỏi cần bạn xác nhận:\n- Tài liệu nói "chờ CHoCH" nhưng không nói rõ khung nào. Bạn dùng M15 hay M5?`
      : `(Câu trả lời mẫu, bản xem trước không gọi AI.) Đã ghi nhận: "${text.slice(0, 160)}". Tôi đã thêm vào mục Ghi chú từ trò chuyện.`
    pb.chat.push({ role: 'user', text, at: Date.now() }, { role: 'assistant', text: reply, at: Date.now() })
    if (!summarize) pb.rules = pb.rules.replace(/\n## Ghi chú từ trò chuyện[\s\S]*$/, '') + `\n\n## Ghi chú từ trò chuyện\n${pb.chat.filter((c) => c.role === 'user' && !c.text.startsWith('Hãy đọc')).map((c) => `- ${c.text} (suy luận, cần xác nhận)`).join('\n')}`
    pb.updatedAt = Date.now()
    return { playbook: JSON.parse(JSON.stringify(pb)), reply }
  }
  if (path === '/ai/rate') {
    // Bản xem trước: không gọi AI thật; dựng câu trả lời mẫu từ các chỉ số app gửi lên.
    await wait(1500)
    const m = body.metrics as Record<string, number>
    const sc = (score: number, label: string, reasons: string[]) => ({ score: Math.max(0, Math.min(100, Math.round(score))), label, reasons })
    const safety = sc(100 - m.maxDrawdownPct * 2.5 - m.worstLossPct * 6 - (1 - m.slShare) * 40, m.maxDrawdownPct > 15 ? 'Rủi ro cao' : 'Khá an toàn',
      [`Sụt giảm lớn nhất ${m.maxDrawdownPct}% từ đỉnh.`, `Lệnh thua lớn nhất mất ${m.worstLossPct}% vốn.`, `${Math.round(m.slShare * 100)}% số lệnh có stop loss.`])
    const growth = sc(55 + m.growthPct * 3 + (Number(m.profitFactor) > 1.5 ? 10 : 0), m.growthPct > 0 ? 'Tăng trưởng khá' : 'Đang lỗ',
      [`Lãi/lỗ ${m.growthPct}% so với vốn.`, `Profit factor ${m.profitFactor}.`, `${Math.round(m.greenWeekShare * 100)}% số tuần có lãi.`])
    const discipline = sc(90 - (1 - m.slShare) * 50 - (m.avgHoldLossMin > m.avgHoldWinMin * 1.5 ? 20 : 0), 'Khá kỷ luật',
      [`Giữ lệnh thắng trung bình ${m.avgHoldWinMin} phút, lệnh thua ${m.avgHoldLossMin} phút.`, 'Lot tương đối đều tay.'])
    const fomo = sc(95 - m.revengeShare * 120 - m.martingaleShare * 80, m.revengeShare > 0.2 ? 'Hay FOMO' : 'Ít FOMO',
      [`${Math.round(m.revengeShare * 100)}% lệnh mở ngay sau một lệnh thua.`, `Trung bình ${Number(m.tradesPerDay).toFixed(1)} lệnh mỗi ngày giao dịch.`])
    const few = m.n < 30
    const ok = [safety, growth, discipline, fomo].every((x) => x.score >= 65)
    if (body.perspective === 'self') {
      return {
        model: 'bản xem trước (câu trả lời mẫu, không gọi AI)',
        rating: {
          safety, growth, discipline, fomo,
          verdict: ok ? { level: 'consider', title: 'Đang giao dịch tốt', detail: 'Rủi ro mỗi lệnh nhỏ và có lãi đều. Giữ nguyên mức rủi ro; đừng tăng lot chỉ vì vừa thắng vài lệnh.' }
            : { level: 'watch', title: 'Cần cải thiện', detail: `Ưu tiên sửa điểm thấp nhất trước. ${m.slShare < 0.9 ? 'Đặt stop loss cho mọi lệnh.' : 'Giữ kỷ luật cắt lỗ như hiện tại.'}` },
          strengths: [`Profit factor ${m.profitFactor}.`],
          red_flags: m.slShare < 0.9 ? [`${Math.round((1 - m.slShare) * 100)}% số lệnh không có stop loss.`] : [`Lệnh thua lớn nhất mất ${m.worstLossPct}% vốn: giữ dưới 1%.`],
          confidence: few ? 'low' : m.n >= 60 ? 'high' : 'medium',
        },
        usage: { input: 0, output: 0 },
      }
    }
    return {
      model: 'bản xem trước (câu trả lời mẫu, không gọi AI)',
      rating: {
        safety, growth, discipline, fomo,
        verdict: few ? { level: 'watch', title: 'Theo dõi thêm', detail: `Mới có ${m.n} lệnh. Kết quả có vẻ ổn nhưng cần thêm ít nhất 30 lệnh và một tháng để chắc chắn. Nếu muốn thử, dùng tài khoản demo trước.` }
          : ok ? { level: 'consider', title: 'Đáng cân nhắc theo', detail: 'Rủi ro được kiểm soát và có lãi đều. Nếu theo, bắt đầu bằng vốn nhỏ và đặt mức dừng lỗ cho cả việc copy.' }
          : { level: 'watch', title: 'Theo dõi thêm', detail: 'Có mặt chưa ổn; chờ thêm vài tuần xem có cải thiện không.' },
        strengths: [`Profit factor ${m.profitFactor}: tổng lãi lớn hơn tổng lỗ.`],
        red_flags: m.slShare < 0.9 ? [`${Math.round((1 - m.slShare) * 100)}% số lệnh không có stop loss.`] : few ? [`Mẫu nhỏ: chỉ ${m.n} lệnh.`] : [],
        confidence: few ? 'low' : m.n >= 60 ? 'high' : 'medium',
      },
      usage: { input: 0, output: 0 },
    }
  }
  if (path === '/ai/analyze') {
    await wait(700)
    const pb = findPb(body.playbook)
    if (!pb.rules.trim()) throw new Error('Bộ kiến thức này chưa có quy tắc. Hãy dạy trước ở mục Học')
    return { analysis: mockAnalysis(body.features as MarketFeatures), model: 'bản xem trước', usage: { input: 0, output: 0 } }
  }
  throw new Error('Không có đường dẫn này')
}

/** Nạp sẵn dữ liệu cho lần mở đầu tiên: Nhật ký đã đồng bộ, nhãn và nhóm tài khoản, vài khoản thu chi. */
export function seed() {
  const put = (k: string, v: unknown) => { try { if (localStorage.getItem(k) == null) localStorage.setItem(k, JSON.stringify(v)) } catch { /* bộ nhớ bị chặn */ } }
  const trades = accounts.filter((a) => a.type !== 'view').flatMap((a) => { const h = historyOf(a); return dealsToTrades(h.deals, h.orders, a.id) })
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
  for (const a of accounts.filter((x) => x.type !== 'prop' && x.type !== 'view')) ledger.push(...balanceDealsToEntries(historyOf(a).deals, a.id, a.label))
  // Lịch sử thi quỹ mẫu, ghi rõ là ví dụ.
  put('fx.challenges', [
    { id: 'c1', firm: 'FTMO', program: 'FTMO 2-Step', size: 100000, fee: 540, date: day(120), status: 'failed', payouts: [], note: '(ví dụ) rớt vì lỗ ngày' },
    { id: 'c2', firm: 'FTMO', program: 'FTMO 2-Step', size: 100000, fee: 540, date: day(75), status: 'funded', account: '520011', payouts: [{ date: day(20), amount: 1850 }], note: '(ví dụ)' },
    { id: 'c3', firm: 'The5ers', program: 'High Stakes', size: 100000, fee: 495, date: day(40), status: 'active', account: '730045', payouts: [], note: '(ví dụ)' },
    { id: 'c4', firm: 'TenTrade', program: 'TenExpress Instant', size: 10000, fee: 99, date: day(30), status: 'funded', payouts: [{ date: day(10), amount: 140 }], note: '(ví dụ)' },
  ])
  put('fx.ledger', ledger)
  const day0 = (d: number) => new Date(T0 + d * 86_400_000).toISOString().slice(0, 10)
  // Ảnh mẫu vẽ bằng SVG (khung xem trước chặn ảnh từ trang khác).
  const art = (title: string, sub: string, c1: string, c2: string, icon = '') => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><radialGradient id="r" cx="0.85" cy="0.1" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="675" fill="url(#g)"/><rect width="1200" height="675" fill="url(#r)"/><g fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="3"><path d="M0 520 L160 470 L300 500 L460 380 L600 420 L760 300 L900 340 L1060 200 L1200 230"/></g><text x="80" y="300" font-family="Arial, sans-serif" font-size="96" font-weight="700" fill="#fff">${icon}${title}</text><text x="84" y="380" font-family="Arial, sans-serif" font-size="40" fill="#fff" fill-opacity="0.85">${sub}</text><text x="84" y="600" font-family="Arial, sans-serif" font-size="28" fill="#fff" fill-opacity="0.6">ẢNH MẪU · XEM TRƯỚC</text></svg>`)
  const now = T0
  put('fx.brandpack', {
    version: 1,
    brand: { brand: 'Golden Duck', tagline: '', accent: '#2a78d6', link: '', disclaimer: true },
    partners: [
      { id: 'exness', name: 'Exness', kind: 'broker', url: 'https://www.exness.com', code: '', cta: 'Mở tài khoản Exness', pitch: '(Ví dụ) Hoàn một phần phí cho khách của nhóm', visible: true },
      { id: 'icmarkets', name: 'IC Markets', kind: 'broker', url: 'https://www.icmarkets.com', code: '', cta: '', pitch: '', visible: true },
      { id: 'ftmo', name: 'FTMO', kind: 'prop', url: 'https://ftmo.com', code: 'VIDU10', cta: 'Mua challenge FTMO', pitch: '(Ví dụ) Mã giảm giá riêng cho cộng đồng', visible: true },
      { id: 'the5ers', name: 'The5ers', kind: 'prop', url: 'https://the5ers.com', code: '', cta: '', pitch: '', visible: true },
      { id: 'tentrade', name: 'TenTrade', kind: 'prop', url: '', code: '', cta: '', pitch: '', visible: true },
      { id: 'tradingview', name: 'TradingView', kind: 'tool', url: 'https://www.tradingview.com', code: '', cta: '', pitch: '', visible: true },
    ],
    offers: [
      { id: 'ex1', partner: 'ftmo', partnerName: '', kind: 'prop', title: '(Ví dụ) Giảm giá challenge cuối năm', detail: 'Ưu đãi mẫu để xem giao diện, không phải khuyến mãi thật. Thay bằng ưu đãi bạn đã kiểm tra trên trang của quỹ.', code: 'MAU-XEM-THU', url: '', expires: day0(2), pinned: true, image: art('FTMO', 'Giảm giá challenge cuối năm', '#1b2a6b', '#f2b33d', ''), cta: 'Mua challenge', createdAt: now },
      { id: 'ex2', partner: 'exness', partnerName: '', kind: 'broker', title: '(Ví dụ) Hoàn phí cho tài khoản mới', detail: 'Ưu đãi mẫu. Ghi rõ điều kiện: tài khoản mới, nạp tối thiểu, thời hạn.', code: '', url: '', expires: day0(20), pinned: false, image: art('Exness', 'Hoàn phí tài khoản mới', '#0b3d2e', '#2fd39a'), cta: '', createdAt: now - 1 },
      { id: 'ex3', partner: 'tradingview', partnerName: '', kind: 'tool', title: '(Ví dụ) Giảm giá gói Premium', detail: 'Ưu đãi mẫu.', code: '', url: '', expires: '', pinned: false, image: art('TradingView', 'Gói Premium', '#131722', '#2962ff'), cta: '', createdAt: now - 2 },
      { id: 'ex4', partner: 'the5ers', partnerName: '', kind: 'prop', title: '(Ví dụ) Tặng thêm 10% cho gói High Stakes', detail: 'Ưu đãi mẫu.', code: '', url: '', expires: day0(9), pinned: false, image: '', cta: '', createdAt: now - 3 },
    ],
    products: [
      { id: 'pd1', category: 'ea', name: '(Ví dụ) Gold Scalper EA', tagline: 'Bot scalping vàng phiên Âu–Mỹ, mỗi lệnh có SL cứng', description: 'Sản phẩm mẫu để xem giao diện. Mô tả cách bot vào lệnh, khung thời gian, mức rủi ro mặc định, yêu cầu VPS.', features: ['Chạy trên MT5', 'Có bản demo dùng thử 7 ngày', 'Hỗ trợ cài đặt qua Telegram', 'Cập nhật miễn phí 1 năm'], price: '2.490.000đ', oldPrice: '3.490.000đ', image: art('Gold Scalper', 'EA cho MT5', '#3a2405', '#f2b33d', ''), buyUrl: '', buyLabel: 'Mua bản quyền', badge: 'Bán chạy', visible: true, createdAt: now },
      { id: 'pd2', category: 'mt5', name: '(Ví dụ) SMC Structure MT5', tagline: 'Tự vẽ BOS, CHoCH, order block, FVG trên MT5', description: 'Sản phẩm mẫu.', features: ['Đa khung thời gian', 'Cảnh báo khi có CHoCH', 'Không vẽ lại (no repaint)'], price: '990.000đ', oldPrice: '', image: art('SMC Structure', 'Indicator MT5', '#0b1f3a', '#5cc2ff'), buyUrl: '', buyLabel: '', badge: 'Mới', visible: true, createdAt: now - 1 },
      { id: 'pd3', category: 'tv', name: '(Ví dụ) Liquidity Map', tagline: 'Đánh dấu thanh khoản phiên Á, đỉnh đáy ngày và tuần trên TradingView', description: 'Sản phẩm mẫu.', features: ['Pine Script v5', 'Mời vào script riêng tư theo username TradingView'], price: '29 USD/tháng', oldPrice: '', image: art('Liquidity Map', 'Indicator TradingView', '#131722', '#b49cff'), buyUrl: '', buyLabel: 'Đăng ký', badge: '', visible: true, createdAt: now - 2 },
      { id: 'pd4', category: 'pdf', name: '(Ví dụ) Sổ tay ICT tiếng Việt', tagline: 'PDF 120 trang, tóm tắt khái niệm và ví dụ', description: 'Sản phẩm mẫu.', features: ['120 trang', 'Kèm bộ quy tắc .md nạp được vào app'], price: 'Miễn phí cho khách IB', oldPrice: '199.000đ', image: '', buyUrl: '', buyLabel: 'Nhận sách', badge: '', visible: true, createdAt: now - 3 },
    ],
    communities: [
      { id: 'cm1', kind: 'channel', name: '(Ví dụ) Thư viện sách trading', description: 'Kênh chia sẻ sách và tài liệu về giao dịch, quản lý vốn, tâm lý.', perk: 'Tải miễn phí sách PDF mỗi tuần', condition: '', url: 'https://t.me/', image: '', visible: true, createdAt: now },
      { id: 'cm2', kind: 'channel', name: '(Ví dụ) Khoá học miễn phí', description: 'Tổng hợp khoá học và video miễn phí về ICT, SMC, price action.', perk: 'Lộ trình học từ cơ bản tới nâng cao', condition: '', url: 'https://t.me/', image: '', visible: true, createdAt: now - 1 },
      { id: 'cm3', kind: 'group', name: '(Ví dụ) Nhóm chat cộng đồng', description: 'Hỏi đáp, chia sẻ lệnh, thảo luận thị trường mỗi ngày.', perk: 'Phân tích sáng và lịch tin mạnh mỗi ngày', condition: '', url: 'https://t.me/', image: '', visible: true, createdAt: now - 2 },
      { id: 'cm4', kind: 'group', name: '(Ví dụ) Nhóm VIP', description: 'Tín hiệu đã duyệt, bảng thành tích tự ghi từ MT5.', perk: 'Tín hiệu và bảng thành tích công khai', condition: 'Dành cho khách mở tài khoản dưới link IB', url: 'https://t.me/', image: '', visible: true, createdAt: now - 3 },
    ],
    proForAll: false, proUrl: 'https://t.me/', proFeatures: ['copy-ai', 'copy-telegram', 'signals'], proPrice: '(Ví dụ) 199.000đ/tháng · miễn phí cho khách mở tài khoản dưới link IB', updatedAt: now,
  })
}
