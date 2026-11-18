/**
 * Chấm điểm tài khoản Only view bằng AI (Claude qua bridge, endpoint /ai/rate).
 * App gửi chỉ số đã tính sẵn (chính xác) và danh sách lệnh rút gọn; AI đọc và chấm bốn điểm, kết luận có đáng theo không.
 * Kết quả lưu trong trình duyệt theo tài khoản và khoảng thời gian, chỉ chấm lại khi có lệnh mới hoặc người dùng bấm.
 */
import type { LiveAccount } from './bridge'
import { rMultiple } from './stats'
import type { Grade, Metrics, Verdict } from './traderScore'
import { netOf, type Trade } from './types'

export interface AiScore { score: number; label: string; reasons: string[] }
export interface AiRating {
  safety: AiScore
  growth: AiScore
  discipline: AiScore
  fomo: AiScore
  verdict: Verdict
  strengths: string[]
  red_flags: string[]
  confidence: 'low' | 'medium' | 'high'
}
export interface StoredRating { rating: AiRating; signature: string; at: number; model: string }

export const gradeOf = (score: number): Grade => (score >= 75 ? 'good' : score >= 55 ? 'ok' : score >= 35 ? 'weak' : 'bad')

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
const r2 = (v: number) => Math.round(v * 100) / 100

/** Dấu vân tay của dữ liệu: đổi khi có lệnh mới đóng. Cùng dấu thì dùng lại kết quả cũ, không tốn phí API. */
export function signature(trades: Trade[], days: number): string {
  const last = trades.reduce((m, t) => Math.max(m, t.closeTime), 0)
  return `${days}:${trades.length}:${last}`
}

/** Dữ liệu gửi cho AI: chỉ số chính xác + lệnh rút gọn + lệnh đang mở. Không gửi mật khẩu hay thông tin đăng nhập. */
export function ratePayload(trades: Trade[], acc: LiveAccount, metrics: Metrics, days: number) {
  const sorted = [...trades].sort((a, b) => a.closeTime - b.closeTime)
  return {
    account: acc.id,
    currency: acc.currency,
    days,
    balance: acc.balance,
    equity: acc.equity,
    metrics: {
      ...metrics,
      winRate: r2(metrics.winRate), growthPct: r2(metrics.growthPct * 100), maxDrawdownPct: r2(metrics.maxDrawdownPct * 100), worstLossPct: r2(metrics.worstLossPct * 100),
      slShare: r2(metrics.slShare), martingaleShare: r2(metrics.martingaleShare), revengeShare: r2(metrics.revengeShare),
      avgHoldWinMin: Math.round(metrics.avgHoldWinMs / 60_000), avgHoldLossMin: Math.round(metrics.avgHoldLossMs / 60_000),
      profitFactor: Number.isFinite(metrics.profitFactor) ? r2(metrics.profitFactor) : 'vô cực (không có lệnh thua)',
    },
    trades_total: sorted.length,
    trades: sorted.slice(-400).map((t) => {
      const r = rMultiple(t)
      return {
        open: iso(t.openTime), close: iso(t.closeTime), symbol: t.symbol, side: t.side, lot: t.volume,
        net: r2(netOf(t)), has_sl: t.sl > 0, r: r == null ? null : r2(r), hold_min: Math.round((t.closeTime - t.openTime) / 60_000),
      }
    }),
    open_positions: acc.positions.map((p) => ({ symbol: p.symbol, side: p.side, lot: p.volume, open_price: p.openPrice, price: p.price, sl: p.sl || null, tp: p.tp || null, profit: p.profit })),
  }
}

// Đổi tên khi cách tính chỉ số thay đổi, để không dùng lại kết quả chấm theo cách cũ.
const KEY = 'fx.aiRate.v2'
export function loadRating(account: string, days: number): StoredRating | null {
  try { return (JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, StoredRating>)[`${account}:${days}`] ?? null } catch { return null }
}
export function saveRating(account: string, days: number, r: StoredRating) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, StoredRating>
    all[`${account}:${days}`] = r
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* bộ nhớ đầy hoặc bị chặn: lần sau chấm lại */ }
}
