/**
 * Cảnh báo tin kiểu Investing: đánh dấu từng tin, hoặc tự bật cho mọi tin từ một mức độ của các đồng tiền đã chọn.
 * Bridge canh giờ và nhắc lại (kể cả khi app đóng); app chỉ đặt cấu hình, hiện tin đang nhắc và nút Tắt.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { bridgeGet, bridgePost } from './bridge'
import type { CalEvent } from './news'

export interface NewsWatchConfig {
  enabled: boolean
  /** Tin được bấm chuông riêng (khoá = newsKey). */
  events: string[]
  /** Tự bật cho mọi tin của các đồng tiền này, từ mức `impact` trở lên. */
  currencies: string[]
  impact: 'High' | 'Medium' | 'Low'
  /** Báo trước bao nhiêu phút. */
  lead_min: number
  /** Nhắc lại mỗi N phút tới khi bấm Tắt hoặc tin ra. 0 = chỉ báo một lần. */
  repeat_min: number
  telegram: boolean
}
export interface ActiveNews { key: string; at: number; title: string; currency: string; impact: string; count: number; last: number }
export interface NewsWatchState { config: NewsWatchConfig; active: ActiveNews[]; acks: string[]; telegram: boolean }

export const DEFAULT_WATCH: NewsWatchConfig = { enabled: true, events: [], currencies: [], impact: 'High', lead_min: 15, repeat_min: 0, telegram: true }
export const newsKey = (e: Pick<CalEvent, 'currency' | 'title' | 'date'>) => `${e.currency}|${e.title}|${e.date}`

const RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 }
/** Tin này có được cảnh báo không: bấm chuông riêng, hoặc khớp quy tắc đồng tiền + mức độ. */
export function isWatched(e: CalEvent, cfg: NewsWatchConfig): 'event' | 'rule' | null {
  if (cfg.events.includes(newsKey(e))) return 'event'
  if (cfg.currencies.includes(e.currency) && (RANK[e.impact] ?? 0) >= RANK[cfg.impact]) return 'rule'
  return null
}

/** Màu theo mức độ ảnh hưởng và theo đồng tiền, để nhìn lịch là thấy ngay. */
export const IMPACT_CLASS: Record<string, string> = { High: 'imp-high', Medium: 'imp-med', Low: 'imp-low', Holiday: 'imp-hol' }
export const CURRENCY_COLOR: Record<string, string> = {
  USD: '#1f9d55', EUR: '#2a6fdb', GBP: '#7b3fe4', JPY: '#d64545', AUD: '#e08a00', NZD: '#0e9aa7', CAD: '#c2410c', CHF: '#be185d', CNY: '#b91c1c',
}

/** Hỏi bridge mỗi 10 giây: cấu hình và các tin đang nhắc. Kêu "ting" khi có lần nhắc mới (nếu trình duyệt cho phát âm thanh). */
export function useNewsWatch(online: boolean) {
  const [state, setState] = useState<NewsWatchState | null>(null)
  const seen = useRef<Record<string, number>>({})
  const load = useCallback(() => bridgeGet<NewsWatchState>('/news/watch').then((s) => {
    const fresh = s.active.some((a) => (seen.current[a.key] ?? 0) < a.count)
    seen.current = Object.fromEntries(s.active.map((a) => [a.key, a.count]))
    if (fresh) chime()
    setState(s)
  }).catch(() => {}), [])
  useEffect(() => {
    if (!online) return
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [online, load])
  const save = async (p: Partial<NewsWatchConfig>) => {
    const config = { ...DEFAULT_WATCH, ...state?.config, ...p }
    setState((s) => (s ? { ...s, config } : s))
    setState(await bridgePost<NewsWatchState>('/news/watch', { config }))
  }
  const ack = async (key?: string) => setState(await bridgePost<NewsWatchState>('/news/ack', key ? { key } : { all: true }))
  return { state, save, ack }
}

function chime() {
  try {
    const ctx = new AudioContext()
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.18 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.3)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.32)
    }
  } catch { /* trình duyệt chặn âm thanh khi chưa có thao tác nào */ }
}
