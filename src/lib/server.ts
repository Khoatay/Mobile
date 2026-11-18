/**
 * Bản chạy trên máy chủ (build với VITE_SERVER=1, npm run build:server): khách đăng nhập, dữ liệu lấy từ /api của máy chủ Golden Duck.
 * Bản xem trước dùng máy chủ giả lập ngay trong trang (mockServer.ts).
 */
import { useCallback, useEffect, useState } from 'react'
import { PREVIEW } from './bridge'
import type { PersonaStore } from './persona'

export const SERVER = import.meta.env.VITE_SERVER === '1'

export interface Me {
  id: number; email: string; name: string; plan: 'free' | 'pro'; planUntil: number | null; admin?: boolean
  telegram: { linked: boolean; name: string; link: string }
  limits: { channels: number; chatPerDay: number }
  chatToday: number
}
export interface ChannelRow { id: number; ref: string; kind: 'public' | 'invite'; title: string; status: string; error: string; last_at: number | null; notify: 0 | 1; messages: number }
export interface Health { ok: boolean; telegram: boolean; telegramError: string; bot: string; ai: boolean }
export type ChatReply = PersonaStore & { reply: string; remaining: number | null; own?: boolean }
export interface ProviderOpt { id: string; label: string; keyUrl: string; hint: string }
export interface MyAi {
  mode: 'system' | 'own'; provider: string; model: string; key: string
  system: { provider: string; label: string; model: string; ready: boolean }
  providers: ProviderOpt[]
}
export interface AdminAi {
  provider: string; model: string; base: string; priceIn: number; priceOut: number; ready: boolean
  keys: Record<string, string>
  today: { calls: number; cost: number; tin: number; tout: number; own: number }
  month: { calls: number; cost: number }
}
/** Nhà cung cấp cho trang quản trị, gồm cả địa chỉ tự nhập. */
export const ADMIN_EXTRA: ProviderOpt = { id: 'custom', label: 'Địa chỉ khác (tương thích OpenAI)', keyUrl: '', hint: 'Nhập địa chỉ API, ví dụ https://…/v1' }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }

export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (PREVIEW) return (await import('./mockServer')).mockApi(path, body) as Promise<T>
  let res: Response
  try {
    res = await fetch(`/api${path}`, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch { throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại') }
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (out as { error?: string }).error ?? `Lỗi ${res.status}`)
  return out as T
}

/** Người đang đăng nhập: undefined khi đang hỏi máy chủ, null khi chưa đăng nhập. */
export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [offline, setOffline] = useState('')
  const reload = useCallback(() => api<Me>('/me').then((m) => { setMe(m); setOffline('') }).catch((e: ApiError) => {
    if (e.status === 401) setMe(null)
    else setOffline(e.message)
  }), [])
  useEffect(() => { reload() }, [reload])
  return { me, setMe, reload, offline }
}

/** Tin của các kênh khách theo dõi, hỏi máy chủ mỗi 5 giây khi trang đang mở. */
export function useFeed(enabled: boolean) {
  const [items, setItems] = useState<{ channel: string; id: number; date: number; text: string }[]>([])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let stop = false
    let last = Math.floor(Date.now() / 1000) - 7 * 86_400
    let all: typeof items = []
    const load = async () => {
      if (document.hidden) return
      try {
        const fresh = await api<typeof items>(`/messages?after=${last}`)
        if (stop || !fresh.length) return
        last = Math.max(last, ...fresh.map((m) => m.date))
        const seen = new Set(all.map((m) => `${m.channel}:${m.id}`))
        all = [...all, ...fresh.filter((m) => !seen.has(`${m.channel}:${m.id}`))]
        setItems(all)
      } catch { /* lần sau thử lại */ }
    }
    load()
    const t = setInterval(load, 5000)
    return () => { stop = true; clearInterval(t) }
  }, [enabled, tick])
  return { items, refresh: () => setTick((t) => t + 1) }
}
