export function money(v: number, ccy = '', digits = 2): string {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${v < 0 ? '−' : ''}${s}${ccy ? ' ' + ccy : ''}`
}

export function signed(v: number, digits = 2): string {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}`
}

export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

export function duration(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} phút`
  const h = m / 60
  if (h < 24) return `${h.toFixed(1)} giờ`
  return `${(h / 24).toFixed(1)} ngày`
}

export function compact(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${sign}${(a / 1e3).toFixed(0)}K`
  return `${sign}${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
