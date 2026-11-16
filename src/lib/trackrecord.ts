import { pipsOf } from './share'
import { computeStats, rMultiple } from './stats'
import { netOf, type Trade } from './types'

export interface TrackOptions {
  title: string
  subtitle: string
  brand: string
  accent: string
  hideMoney: boolean
  currency: string
  /** Nút kêu gọi ở cuối trang, ví dụ link IB. */
  ctaLabel: string
  ctaUrl: string
  disclaimer: boolean
  recent: number
}

export interface TrackData {
  n: number
  winRate: number
  profitFactor: number
  pips: number
  rSum: number
  rCount: number
  net: number
  maxDrawdown: number
  firstDay: string
  lastDay: string
  verifiedShare: number
  months: { month: string; n: number; winRate: number; pips: number; r: number; net: number }[]
  curve: number[]
}

/** Số liệu cho trang thành tích. Khi ẩn tiền, đường cong và bảng dùng pip thay cho số tiền. */
export function trackData(input: Trade[], hideMoney: boolean): TrackData {
  const trades = [...input].sort((a, b) => a.closeTime - b.closeTime)
  const s = computeStats(trades, 0)
  const pips = trades.map((t) => pipsOf(t) ?? 0)
  const months = new Map<string, Trade[]>()
  for (const t of trades) { const k = new Date(t.closeTime).toISOString().slice(0, 7); months.set(k, [...(months.get(k) ?? []), t]) }
  let acc = 0
  const curve = [0, ...trades.map((t, i) => (acc += hideMoney ? pips[i] : netOf(t)))]
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return {
    n: s.n, winRate: s.winRate, profitFactor: s.profitFactor, net: s.net, maxDrawdown: s.maxDrawdown,
    pips: pips.reduce((a, b) => a + b, 0),
    rSum: trades.map(rMultiple).filter((x): x is number => x != null).reduce((a, b) => a + b, 0),
    rCount: s.rCount,
    firstDay: trades.length ? day(trades[0].closeTime) : '', lastDay: trades.length ? day(trades[trades.length - 1].closeTime) : '',
    verifiedShare: trades.length ? trades.filter((t) => t.source === 'mt5' && t.account).length / trades.length : 0,
    months: [...months.entries()].sort().map(([month, l]) => ({
      month, n: l.length, winRate: l.filter((t) => netOf(t) > 0).length / l.length,
      pips: l.reduce((a, t) => a + (pipsOf(t) ?? 0), 0),
      r: l.map(rMultiple).filter((x): x is number => x != null).reduce((a, b) => a + b, 0),
      net: l.reduce((a, t) => a + netOf(t), 0),
    })),
    curve,
  }
}

/** Mã kiểm tra: SHA-256 của danh sách lệnh (số lệnh, giờ, giá, kết quả). Cùng dữ liệu luôn ra cùng mã. */
export async function dataHash(trades: Trade[]): Promise<string> {
  const rows = [...trades].sort((a, b) => a.closeTime - b.closeTime).map((t) => [t.id, t.symbol, t.side, t.volume, t.openTime, t.closeTime, t.openPrice, t.closePrice, netOf(t).toFixed(2)].join('|')).join('\n')
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rows))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const sign = (v: number, d = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`

function curveSvg(values: number[], accent: string): string {
  if (values.length < 2) return ''
  const W = 900, H = 260, pad = 10
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values)
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2)
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - pad * 2)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Đường kết quả luỹ kế"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="currentColor" stroke-opacity=".2"/><path d="${line}L${x(values.length - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="${accent}" fill-opacity=".12"/><path d="${line}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`
}

/** Trang HTML độc lập: không cần mạng, không tải thư viện nào, mở bằng trình duyệt là xem được. */
export function trackRecordHtml(trades: Trade[], o: TrackOptions, hash: string): string {
  const d = trackData(trades, o.hideMoney)
  const unit = o.hideMoney ? 'pip' : o.currency
  const recent = [...trades].sort((a, b) => b.closeTime - a.closeTime).slice(0, o.recent)
  const pf = Number.isFinite(d.profitFactor) ? d.profitFactor.toFixed(2) : '∞'
  const tile = (label: string, value: string, tone = '') => `<div class="tile ${tone}"><span>${label}</span><strong>${value}</strong></div>`
  const tone = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '')
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<style>
:root{--bg:#f4f6fb;--card:#fff;--ink:#0f1729;--ink2:#4a5568;--muted:#7a8599;--line:#e5e9f2;--pos:#0f9d6a;--neg:#e5484d;--accent:${o.accent}}
@media (prefers-color-scheme:dark){:root{--bg:#090e18;--card:#111a2a;--ink:#e8edf6;--ink2:#a9b4c7;--muted:#7c889c;--line:#1d2839;--pos:#1fae78;--neg:#d9434f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-left)) 48px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.brand{font-weight:800;color:var(--accent);letter-spacing:.02em;text-transform:uppercase;font-size:13px}
h1{margin:4px 0;font-size:28px;line-height:1.2}p{margin:0}.sub{color:var(--ink2)}
.badge{display:inline-flex;gap:6px;align-items:center;background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos);font-weight:700;font-size:13px;padding:5px 12px;border-radius:999px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column}
.tile span{font-size:12.5px;color:var(--muted)}.tile strong{font-size:22px;font-variant-numeric:tabular-nums}
.tile.pos strong{color:var(--pos)}.tile.neg strong{color:var(--neg)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:14px 0}
.card h2{font-size:15px;margin:0 0 10px}.chart svg{width:100%;height:240px;display:block;color:var(--ink)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
th:first-child,td:first-child{text-align:left}.pos{color:var(--pos)}.neg{color:var(--neg)}
.cta{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 18%,var(--card)),var(--card));border-color:color-mix(in srgb,var(--accent) 40%,transparent)}
.cta a{background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:10px}
footer{color:var(--muted);font-size:12px;margin-top:18px}code{font-size:11.5px;word-break:break-all}
</style></head><body><div class="wrap">
<header><div><div class="brand">${esc(o.brand)}</div><h1>${esc(o.title)}</h1>${o.subtitle ? `<p class="sub">${esc(o.subtitle)}</p>` : ''}<p class="sub">${d.firstDay} – ${d.lastDay} · ${d.n} lệnh</p></div>
<span class="badge">✓ ${Math.round(d.verifiedShare * 100)}% lệnh đọc thẳng từ MT5</span></header>
<div class="tiles">
${tile(o.hideMoney ? 'Tổng pip' : `Lãi/lỗ ròng (${esc(o.currency)})`, o.hideMoney ? sign(d.pips) : sign(d.net, 2), tone(o.hideMoney ? d.pips : d.net))}
${tile('Tỷ lệ thắng', `${Math.round(d.winRate * 100)}%`)}
${tile('Profit factor', pf, d.profitFactor >= 1 ? 'pos' : 'neg')}
${d.rCount ? tile('Tổng R', `${sign(d.rSum, 1)}R`, tone(d.rSum)) : ''}
${o.hideMoney ? '' : tile('Sụt giảm lớn nhất', d.maxDrawdown.toLocaleString('en-US', { maximumFractionDigits: 0 }))}
</div>
<section class="card chart"><h2>Kết quả luỹ kế (${esc(unit)})</h2>${curveSvg(d.curve, o.accent)}</section>
<section class="card"><h2>Theo tháng</h2><div class="scroll"><table><thead><tr><th>Tháng</th><th>Lệnh</th><th>Thắng</th><th>Pip</th><th>R</th>${o.hideMoney ? '' : `<th>Lãi/lỗ</th>`}</tr></thead><tbody>
${d.months.map((m) => `<tr><td>${m.month}</td><td>${m.n}</td><td>${Math.round(m.winRate * 100)}%</td><td class="${tone(m.pips)}">${sign(m.pips)}</td><td class="${tone(m.r)}">${sign(m.r, 1)}</td>${o.hideMoney ? '' : `<td class="${tone(m.net)}">${sign(m.net, 2)}</td>`}</tr>`).join('')}
</tbody></table></div></section>
${o.recent ? `<section class="card"><h2>${recent.length} lệnh gần nhất</h2><div class="scroll"><table><thead><tr><th>Đóng lúc</th><th>Cặp</th><th>Chiều</th><th>Giá vào</th><th>Giá ra</th><th>Pip</th><th>R</th>${o.hideMoney ? '' : '<th>Lãi/lỗ</th>'}</tr></thead><tbody>
${recent.map((t) => { const p = pipsOf(t) ?? 0, r = rMultiple(t); return `<tr><td>${new Date(t.closeTime).toISOString().slice(0, 16).replace('T', ' ')}</td><td>${esc(t.symbol)}</td><td>${t.side === 'buy' ? 'Buy' : 'Sell'}</td><td>${t.openPrice}</td><td>${t.closePrice}</td><td class="${tone(p)}">${sign(p, 1)}</td><td class="${r == null ? '' : tone(r)}">${r == null ? '–' : sign(r, 2)}</td>${o.hideMoney ? '' : `<td class="${tone(netOf(t))}">${sign(netOf(t), 2)}</td>`}</tr>` }).join('')}
</tbody></table></div></section>` : ''}
${o.ctaUrl ? `<section class="card cta"><div><strong>${esc(o.ctaLabel || 'Tham gia cộng đồng')}</strong><p class="sub">Giao dịch cùng ${esc(o.brand)}.</p></div><a href="${esc(o.ctaUrl)}" target="_blank" rel="noopener noreferrer">${esc(o.ctaLabel || 'Tham gia')}</a></section>` : ''}
<footer><p>Tạo bởi ${esc(o.brand)} lúc ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Giờ lệnh theo giờ máy chủ broker.</p>
<p>Mã kiểm tra dữ liệu (SHA-256): <code>${hash}</code></p>
${o.disclaimer ? '<p>Kết quả quá khứ không đảm bảo kết quả tương lai. Giao dịch có rủi ro mất vốn. Đây không phải khuyến nghị đầu tư.</p>' : ''}</footer>
</div></body></html>`
}
