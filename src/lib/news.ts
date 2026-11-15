import { parseSymbol } from './forex'

export interface CalEvent { title: string; currency: string; date: string; impact: string; forecast: string; previous: string }

export const IMPACT_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 }

/** Các đồng tiền có trong danh sách mã (EURUSD -> EUR, USD; XAUUSD -> USD). */
export function currenciesOf(symbols: string[]): string[] {
  const out = new Set<string>()
  for (const s of symbols) {
    const info = parseSymbol(s)
    if (!info) continue
    for (const c of [info.base, info.quote]) if (c !== 'XAU' && c !== 'XAG') out.add(c)
  }
  return [...out].sort()
}

/** Tin mức cao sắp ra trong `minutes` phút tới, ảnh hưởng tới các đồng tiền đang giữ lệnh. */
export function imminent(events: CalEvent[], held: string[], now: number, minutes = 60): CalEvent[] {
  return events.filter((e) => {
    const t = Date.parse(e.date)
    return e.impact === 'High' && held.includes(e.currency) && t >= now && t - now <= minutes * 60_000
  })
}

export function filterEvents(events: CalEvent[], minImpact: number, currencies: string[] | null): CalEvent[] {
  return events
    .filter((e) => (IMPACT_RANK[e.impact] ?? 0) >= minImpact && (!currencies || currencies.includes(e.currency)) && Number.isFinite(Date.parse(e.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
}
