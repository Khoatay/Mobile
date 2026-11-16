import type { CalEvent } from './news'
import type { Trade } from './types'

export interface AutopostConfig {
  target: string
  /** auto: gửi ngay; approve: đưa vào hàng chờ, bạn bấm duyệt mới gửi. */
  mode: 'auto' | 'approve'
  morning: { on: boolean; time: string; withMedium: boolean }
  results: { on: boolean; accounts: string[]; minNet: number }
  weekly: { on: boolean; weekday: number; time: string }
}
export const DEFAULT_AUTOPOST: AutopostConfig = {
  target: '', mode: 'approve',
  morning: { on: false, time: '07:30', withMedium: false },
  results: { on: false, accounts: [], minNet: 0 },
  weekly: { on: false, weekday: 5, time: '22:00' },
}
export interface QueuedPost { id: string; kind: 'morning' | 'result' | 'weekly'; text: string; image: string; createdAt: number; status: 'pending' | 'sent' | 'skipped' | 'error'; error?: string }
export interface AutopostState { lastMorning: string; lastWeekly: string; seen: string[]; queue: QueuedPost[]; startedAt: number }
export const EMPTY_STATE: AutopostState = { lastMorning: '', lastWeekly: '', seen: [], queue: [], startedAt: 0 }

export const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0) }

/** Đã tới giờ đăng bài buổi sáng hôm nay mà chưa đăng? (theo giờ máy tính) */
export function morningDue(cfg: AutopostConfig, st: AutopostState, now: Date): boolean {
  return cfg.morning.on && st.lastMorning !== ymd(now) && now.getHours() * 60 + now.getMinutes() >= minutes(cfg.morning.time)
}

/** Khoá của tuần (ngày thứ Hai đầu tuần). */
export function weekKey(now: Date): string {
  const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d)
}
export function weeklyDue(cfg: AutopostConfig, st: AutopostState, now: Date): boolean {
  return cfg.weekly.on && st.lastWeekly !== weekKey(now) && now.getDay() === cfg.weekly.weekday && now.getHours() * 60 + now.getMinutes() >= minutes(cfg.weekly.time)
}

/** Lệnh mới đóng cần đăng: đúng tài khoản, đóng sau khi bật, chưa đăng, đủ ngưỡng lãi/lỗ. */
export function newResults(trades: Trade[], cfg: AutopostConfig, st: AutopostState, serverOffsetH: number): Trade[] {
  if (!cfg.results.on) return []
  const seen = new Set(st.seen)
  return trades
    .filter((t) => t.account && cfg.results.accounts.includes(t.account) && !seen.has(t.id))
    .filter((t) => t.closeTime - serverOffsetH * 3_600_000 >= st.startedAt)
    .filter((t) => Math.abs(t.profit + t.commission + t.swap) >= cfg.results.minNet)
    .sort((a, b) => a.closeTime - b.closeTime)
}

/** Bài lịch tin hôm nay theo giờ máy tính. */
export function morningText(events: CalEvent[], now: Date, withMedium: boolean, footer: string): string {
  const today = ymd(now)
  const list = events
    .filter((e) => (e.impact === 'High' || (withMedium && e.impact === 'Medium')) && ymd(new Date(Date.parse(e.date))) === today)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const t = (iso: string) => new Date(Date.parse(iso)).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const head = `☀️ Lịch tin ${WEEKDAY_NAMES[now.getDay()].toLowerCase()}, ${today.split('-').reverse().join('/')}`
  const body = list.length
    ? list.map((e) => `${e.impact === 'High' ? '🔴' : '🟠'} ${t(e.date)} ${e.currency} · ${e.title}${e.forecast ? ` (dự báo ${e.forecast}, trước ${e.previous || '–'})` : ''}`).join('\n')
    : 'Hôm nay không có tin mạnh. Thị trường thường đi theo kỹ thuật, vẫn nhớ quản lý rủi ro.'
  const currencies = [...new Set(list.filter((e) => e.impact === 'High').map((e) => e.currency))]
  const tip = currencies.length ? `\n\nCẩn thận với các cặp có ${currencies.join(', ')} quanh giờ ra tin.` : ''
  return [head, body + tip, footer].filter(Boolean).join('\n\n')
}
