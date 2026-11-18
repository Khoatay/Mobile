import { useEffect, useRef } from 'react'
import { DEFAULT_AUTOPOST, EMPTY_STATE, morningDue, morningText, newResults, weekKey, weeklyDue, ymd, type AutopostConfig, type AutopostState, type QueuedPost } from './autopost'
import { bridgeGet, bridgePost, type Mt5Deal, type Mt5Order } from './bridge'
import { loadImage } from './images'
import { logoOf } from './brand'
import { dealsToTrades } from './mt5deals'
import type { CalEvent } from './news'
import { drawBanner, footer, periodTrades, resultPost, statsPost, type Post, type Profile } from './share'
import { mergeTrades, usePersistent } from './store'
import type { Trade } from './types'
import type { UserProfile } from './user'

export interface AutopostApi {
  cfg: AutopostConfig
  setCfg: (c: AutopostConfig) => void
  state: AutopostState
  approve: (id: string) => void
  skip: (id: string) => void
  runNow: (kind: 'morning' | 'weekly') => void
  clearDone: () => void
}

interface Deps { online: boolean; trades: Trade[]; setTrades: (t: Trade[]) => void; profile: Profile; user: UserProfile; serverOffset: number; currency: string }

/** Vẽ banner ra ảnh PNG (data URL), có ảnh đại diện người đăng. */
async function bannerImage(post: Post, profile: Profile, user: UserProfile): Promise<string> {
  const c = document.createElement('canvas')
  const [img, logo] = await Promise.all([loadImage(user.avatar), loadImage(logoOf(profile))])
  drawBanner(c, post.spec, profile, user.displayName || user.avatar ? { name: user.displayName || user.username, handle: user.username ? `@${user.username}` : undefined, image: img } : undefined, logo)
  return c.toDataURL('image/png')
}

/**
 * Chạy khi app mở: mỗi phút kiểm tra lịch đăng buổi sáng và cuối tuần; mỗi 2 phút lấy lịch sử MT5 của các tài khoản
 * đã chọn, đưa lệnh mới vào Nhật ký và đăng kết quả. Chế độ "duyệt trước" thì đưa bài vào hàng chờ.
 */
export function useAutopost(d: Deps): AutopostApi {
  const [stored, setCfg] = usePersistent<AutopostConfig>('fx.autopost', DEFAULT_AUTOPOST)
  const cfg: AutopostConfig = { ...DEFAULT_AUTOPOST, ...stored, morning: { ...DEFAULT_AUTOPOST.morning, ...stored.morning }, results: { ...DEFAULT_AUTOPOST.results, ...stored.results }, weekly: { ...DEFAULT_AUTOPOST.weekly, ...stored.weekly } }
  const [state, setState] = usePersistent<AutopostState>('fx.autopost.state', EMPTY_STATE)
  const ref = useRef({ cfg, state, d })
  ref.current = { cfg, state, d }
  const busy = useRef(false)

  const patch = (p: Partial<AutopostState> | ((s: AutopostState) => Partial<AutopostState>)) =>
    setState((s) => ({ ...EMPTY_STATE, ...s, ...(typeof p === 'function' ? p({ ...EMPTY_STATE, ...s }) : p) }))

  async function deliver(item: QueuedPost) {
    const { cfg } = ref.current
    try {
      await bridgePost('/telegram/send', { target: cfg.target, text: item.text, image: item.image })
      patch((s) => ({ queue: s.queue.map((q) => (q.id === item.id ? { ...q, status: 'sent' } : q)) }))
    } catch (e) {
      patch((s) => ({ queue: s.queue.map((q) => (q.id === item.id ? { ...q, status: 'error', error: e instanceof Error ? e.message : 'Lỗi' } : q)) }))
    }
  }

  async function enqueue(kind: QueuedPost['kind'], text: string, image = '') {
    const item: QueuedPost = { id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, text, image, createdAt: Date.now(), status: 'pending' }
    patch((s) => ({ queue: [item, ...s.queue].slice(0, 60) }))
    if (ref.current.cfg.mode === 'auto') await deliver(item)
  }

  async function morning() {
    const { d } = ref.current
    const events = await bridgeGet<CalEvent[]>('/calendar').catch(() => [] as CalEvent[])
    await enqueue('morning', morningText(events, new Date(), ref.current.cfg.morning.withMedium, footer(d.profile)))
  }
  async function weekly() {
    const { d, cfg } = ref.current
    const pool = d.trades.filter((t) => !cfg.results.accounts.length || (t.account && cfg.results.accounts.includes(t.account)))
    const list = periodTrades(pool, 'week', Date.now() + d.serverOffset * 3_600_000)
    if (!list.length) return
    const post = statsPost(list, 'Tuần này', d.currency, d.profile)
    await enqueue('weekly', post.caption, await bannerImage(post, d.profile, d.user))
  }

  async function tick(fetchHistory: boolean) {
    const { cfg, state, d } = ref.current
    if (busy.current || !d.online || !cfg.target) return
    busy.current = true
    try {
      const now = new Date()
      if (morningDue(cfg, state, now)) { patch({ lastMorning: ymd(now) }); await morning() }
      if (weeklyDue(cfg, state, now)) { patch({ lastWeekly: weekKey(now) }); await weekly() }
      if (fetchHistory && cfg.results.on && cfg.results.accounts.length) {
        let all = d.trades
        for (const id of cfg.results.accounts) {
          try {
            const h = await bridgeGet<{ deals: Mt5Deal[]; orders: Mt5Order[] }>(`/history?days=2&account=${id}`)
            all = mergeTrades(all, dealsToTrades(h.deals, h.orders, id)).trades
          } catch { /* tài khoản tạm mất kết nối */ }
        }
        if (all.length !== d.trades.length) d.setTrades(all)
        const fresh = newResults(all, cfg, ref.current.state, d.serverOffset)
        if (fresh.length) {
          patch((s) => ({ seen: [...s.seen, ...fresh.map((t) => t.id)].slice(-2000) }))
          for (const t of fresh.slice(-5)) {
            const post = resultPost(t, d.currency, d.profile)
            await enqueue('result', post.caption, await bannerImage(post, d.profile, d.user))
          }
        }
      }
    } finally {
      busy.current = false
    }
  }

  useEffect(() => {
    let n = 0
    const id = setInterval(() => { n++; tick(n % 2 === 0) }, 60_000)
    tick(true)
    return () => clearInterval(id)
  }, [d.online])

  return {
    cfg,
    setCfg: (c) => {
      // Bật đăng kết quả: chỉ đăng lệnh đóng từ giờ trở đi.
      if (c.results.on && !cfg.results.on) patch({ startedAt: Date.now() })
      setCfg(c)
    },
    state: { ...EMPTY_STATE, ...state },
    approve: (id) => { const q = state.queue.find((x) => x.id === id); if (q) deliver(q) },
    skip: (id) => patch((s) => ({ queue: s.queue.map((q) => (q.id === id ? { ...q, status: 'skipped' } : q)) })),
    runNow: (kind) => { (kind === 'morning' ? morning() : weekly()).catch(() => {}) },
    clearDone: () => patch((s) => ({ queue: s.queue.filter((q) => q.status === 'pending') })),
  }
}
