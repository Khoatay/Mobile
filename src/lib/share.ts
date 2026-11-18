import { BRAND_NAME, brandName } from './brand'
import type { PartnerLinks } from './partners'
import { parseSymbol, pipSize } from './forex'
import { pct, signed } from './format'
import { computeStats, rMultiple } from './stats'
import { netOf, type Side, type Trade } from './types'

export interface Profile {
  /** Tên thương hiệu / cộng đồng, hiện ở góc app và trên banner. */
  brand: string
  tagline: string
  accent: string
  /** Link giới thiệu (IB, affiliate), thêm vào cuối bài đăng. */
  link: string
  disclaimer: boolean
  /** Ẩn số tiền trên banner và bài đăng, chỉ hiện pip, R, %. */
  hideMoney: boolean
  /** Link IB, affiliate quỹ và công cụ, kèm mã giảm giá nếu có. */
  partners: PartnerLinks
  /** Logo riêng của IB (data URL PNG vuông 256px hoặc link ảnh). Trống = logo Golden Duck. */
  logo?: string
  /** Người dùng bản trader đã tự chọn màu nhấn (thay cho màu của IB). */
  accentCustom?: boolean
}

export const DEFAULT_PROFILE: Profile = { brand: BRAND_NAME, logo: '', tagline: '', accent: '#2a78d6', link: '', disclaimer: true, hideMoney: true, partners: {} }
export const ACCENTS = ['#2a78d6', '#1baf7a', '#eb6834', '#6250d6', '#d55181', '#c98500']
export const DISCLAIMER = 'Chia sẻ góc nhìn cá nhân, không phải khuyến nghị đầu tư. Giao dịch có rủi ro mất vốn.'

export interface BannerSpec {
  kicker: string
  title: string
  big: string
  tone: 'pos' | 'neg' | 'neutral'
  rows: [string, string][]
}
export interface Post { spec: BannerSpec; caption: string }

export function footer(p: Profile): string {
  return [p.disclaimer ? `⚠️ ${DISCLAIMER}` : '', p.link ? `🔗 ${p.link}` : '', p.brand ? `— ${p.brand}` : ''].filter(Boolean).join('\n')
}
const join = (...parts: string[]) => parts.filter(Boolean).join('\n\n')

/** Số pip lãi/lỗ của một lệnh theo biến động giá; null nếu không nhận ra cặp tiền. */
export function pipsOf(t: Trade): number | null {
  const info = parseSymbol(t.symbol)
  if (!info) return null
  return ((t.closePrice - t.openPrice) * (t.side === 'buy' ? 1 : -1)) / pipSize(info)
}

export interface SignalDraft { symbol: string; side: Side; entry: number; sl: number; tps: number[]; note: string }

export function signalPost(d: SignalDraft, p: Profile): Post {
  const dir = d.side === 'buy' ? 'BUY' : 'SELL'
  const rr = d.tps.length && d.entry !== d.sl ? Math.abs(d.tps[0] - d.entry) / Math.abs(d.entry - d.sl) : null
  const rows: [string, string][] = [['Giá vào', String(d.entry)], ['Stop loss', String(d.sl)], ...d.tps.map((tp, i): [string, string] => [`Take profit ${d.tps.length > 1 ? i + 1 : ''}`.trim(), String(tp)])]
  if (rr != null) rows.push(['R:R', `1:${rr.toFixed(1)}`])
  const lines = [`📊 ${d.symbol} — ${dir}`, `Giá vào: ${d.entry}`, `SL: ${d.sl}`, ...d.tps.map((tp, i) => `TP${d.tps.length > 1 ? i + 1 : ''}: ${tp}`), rr != null ? `R:R 1:${rr.toFixed(1)}` : ''].filter(Boolean)
  return {
    spec: { kicker: 'Ý tưởng giao dịch', title: d.symbol, big: dir, tone: d.side === 'buy' ? 'pos' : 'neg', rows },
    caption: join(lines.join('\n'), d.note.trim(), footer(p)),
  }
}

export function resultPost(t: Trade, ccy: string, p: Profile): Post {
  const pips = pipsOf(t)
  const r = rMultiple(t)
  const net = netOf(t)
  const win = net > 0
  const headline = pips != null ? `${signed(pips, 1)} pip` : r != null ? `${signed(r)}R` : win ? 'Thắng' : 'Thua'
  const rows: [string, string][] = [['Chiều', t.side === 'buy' ? 'Buy' : 'Sell'], ['Giá vào', String(t.openPrice)], ['Giá ra', String(t.closePrice)]]
  if (r != null) rows.push(['Kết quả', `${signed(r)}R`])
  if (!p.hideMoney) rows.push(['Lãi/lỗ ròng', `${signed(net)} ${ccy}`])
  const lines = [`${win ? '✅' : '❌'} ${t.symbol} ${t.side === 'buy' ? 'BUY' : 'SELL'} đã đóng: ${headline}`, `Vào ${t.openPrice} → ra ${t.closePrice}`, r != null ? `Kết quả: ${signed(r)}R` : '', !p.hideMoney ? `Lãi/lỗ ròng: ${signed(net)} ${ccy}` : ''].filter(Boolean)
  return {
    spec: { kicker: win ? 'Lệnh chốt lời' : 'Lệnh cắt lỗ', title: t.symbol, big: headline, tone: win ? 'pos' : net < 0 ? 'neg' : 'neutral', rows },
    caption: join(lines.join('\n'), t.note?.trim() ?? '', footer(p)),
  }
}

export type Period = 'today' | 'week' | 'month' | 'last30'
export const PERIODS: Record<Period, string> = { today: 'Hôm nay', week: 'Tuần này', month: 'Tháng này', last30: '30 ngày qua' }

/** Lọc lệnh đóng trong kỳ, theo ngày của máy chủ broker. Tuần bắt đầu từ thứ Hai. */
export function periodTrades(trades: Trade[], period: Period, nowServer: number): Trade[] {
  const d = new Date(nowServer)
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const from =
    period === 'today' ? day
    : period === 'week' ? day - ((d.getUTCDay() + 6) % 7) * 86_400_000
    : period === 'month' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
    : day - 29 * 86_400_000
  return trades.filter((t) => t.closeTime >= from && t.closeTime <= nowServer + 86_400_000)
}

export function statsPost(trades: Trade[], periodLabel: string, ccy: string, p: Profile): Post {
  // Chỉ hạ chữ đầu, để tên nhóm hay tài khoản ghép phía sau giữ nguyên.
  const period = periodLabel.charAt(0).toLowerCase() + periodLabel.slice(1)
  const s = computeStats(trades, 0)
  const pipsList = trades.map(pipsOf).filter((x): x is number => x != null)
  const pips = pipsList.reduce((a, b) => a + b, 0)
  const rSum = trades.map(rMultiple).filter((x): x is number => x != null).reduce((a, b) => a + b, 0)
  const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'
  const rows: [string, string][] = [['Số lệnh', String(s.n)], ['Tỷ lệ thắng', pct(s.winRate, 0)], ['Thắng / thua', `${s.wins} / ${s.losses}`], ['Profit factor', pf]]
  if (s.rCount) rows.push(['Tổng R', `${signed(rSum, 1)}R`])
  if (!p.hideMoney) rows.push(['Lãi/lỗ ròng', `${signed(s.net)} ${ccy}`])
  const lines = [`📈 Thống kê ${period}`, `Tổng: ${signed(pips, 0)} pip qua ${s.n} lệnh`, `Tỷ lệ thắng: ${pct(s.winRate, 0)} (${s.wins} thắng, ${s.losses} thua)`, `Profit factor: ${pf}`, s.rCount ? `Tổng R: ${signed(rSum, 1)}R` : '', !p.hideMoney ? `Lãi/lỗ ròng: ${signed(s.net)} ${ccy}` : ''].filter(Boolean)
  return {
    spec: { kicker: `Thống kê ${period}`, title: `${s.n} lệnh`, big: `${signed(pips, 0)} pip`, tone: pips > 0 ? 'pos' : pips < 0 ? 'neg' : 'neutral', rows },
    caption: join(lines.join('\n'), footer(p)),
  }
}

/** Vẽ banner vuông 1080px lên canvas. Chữ dùng font hệ thống nên hiển thị được tiếng Việt. */
/** Tác giả hiện ở góc trên bên phải banner: ảnh đại diện tròn và tên. */
export interface BannerAuthor { name: string; handle?: string; image: HTMLImageElement | null }

/** `logo`: icon thương hiệu vẽ cạnh tên ở góc trên trái; không có thì chỉ có chữ. */
export function drawBanner(canvas: HTMLCanvasElement, spec: BannerSpec, p: Profile, author?: BannerAuthor, logo?: HTMLImageElement | null) {
  const W = 1080
  canvas.width = canvas.height = W
  const g = canvas.getContext('2d')
  if (!g) return
  const font = (size: number, weight = 400) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`
  const tone = spec.tone === 'pos' ? '#35c98f' : spec.tone === 'neg' ? '#f06a6a' : '#f0efec'

  g.fillStyle = '#111113'
  g.fillRect(0, 0, W, W)
  const glow = g.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, W * 0.9)
  glow.addColorStop(0, p.accent + '55')
  glow.addColorStop(1, 'transparent')
  g.fillStyle = glow
  g.fillRect(0, 0, W, W)
  g.fillStyle = p.accent
  g.fillRect(0, 0, 16, W)

  if (logo) g.drawImage(logo, 80, 56, 100, 100)
  const textX = logo ? 204 : 80
  g.textBaseline = 'alphabetic'
  g.fillStyle = '#f0efec'
  g.font = font(40, 700)
  g.fillText(brandName(p.brand), textX, 110)
  if (p.tagline) { g.fillStyle = '#9a988f'; g.font = font(26); g.fillText(p.tagline, textX, 152, author ? W - 440 - textX : W - 80 - textX) }

  if (author && (author.name || author.image)) {
    const r = 40, cx = W - 80 - r, cy = 108
    g.save()
    g.beginPath(); g.arc(cx, cy, r + 4, 0, Math.PI * 2); g.fillStyle = p.accent; g.fill()
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.closePath(); g.clip()
    if (author.image) {
      const s = Math.min(author.image.width, author.image.height)
      g.drawImage(author.image, (author.image.width - s) / 2, (author.image.height - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2)
    } else {
      const grad = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
      grad.addColorStop(0, '#8fd3ff'); grad.addColorStop(1, '#b49cff')
      g.fillStyle = grad; g.fillRect(cx - r, cy - r, r * 2, r * 2)
      const words = author.name.trim().split(/\s+/)
      const ini = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : author.name.slice(0, 2)).toUpperCase()
      g.fillStyle = '#0b1322'; g.font = font(32, 700); g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText(ini, cx, cy + 2)
    }
    g.restore()
    g.textAlign = 'right'; g.textBaseline = 'alphabetic'
    g.fillStyle = '#f0efec'; g.font = font(30, 700)
    g.fillText(author.name, cx - r - 22, author.handle ? 102 : 118, 360)
    if (author.handle) { g.fillStyle = '#9a988f'; g.font = font(24); g.fillText(author.handle, cx - r - 22, 138, 360) }
    g.textAlign = 'left'
  }

  g.fillStyle = p.accent
  g.font = font(30, 600)
  g.fillText(spec.kicker.toUpperCase(), 80, 270)
  g.fillStyle = '#f0efec'
  g.font = font(92, 700)
  g.fillText(spec.title, 80, 370, W - 160)
  g.fillStyle = tone
  g.font = font(132, 800)
  g.fillText(spec.big, 80, 520, W - 160)

  let y = 620
  for (const [label, value] of spec.rows.slice(0, 6)) {
    g.fillStyle = '#2a2a2d'
    g.fillRect(80, y - 44, W - 160, 2)
    g.fillStyle = '#9a988f'
    g.font = font(32)
    g.textAlign = 'left'
    g.fillText(label, 80, y)
    g.fillStyle = '#f0efec'
    g.font = font(34, 600)
    g.textAlign = 'right'
    g.fillText(value, W - 80, y)
    y += 62
  }
  g.textAlign = 'left'
  g.fillStyle = '#77756e'
  g.font = font(22)
  if (p.disclaimer) g.fillText(DISCLAIMER, 80, W - 76, W - 160)
  if (p.link) { g.fillStyle = '#b8b6ad'; g.font = font(24, 600); g.fillText(p.link, 80, W - 36, W - 160) }
}
