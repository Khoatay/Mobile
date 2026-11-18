/**
 * Mô phỏng khả năng qua vòng quỹ (Monte Carlo) từ chính cách giao dịch của người dùng.
 * Dùng R của các lệnh có SL (lãi/lỗ tính theo số lần rủi ro), nên không phụ thuộc cỡ tài khoản:
 * mỗi lệnh mô phỏng lãi/lỗ = R × (% rủi ro × vốn ban đầu). Số lệnh mỗi ngày lấy từ các ngày giao dịch thật.
 * Không thấy biến động trong lệnh (equity giữa chừng), nên kết quả hơi lạc quan với giới hạn lỗ ngày.
 */
import { dayKey, type PropConfig, type PropStatus } from './prop'
import { rMultiple } from './stats'
import type { Trade } from './types'

export interface SimResult { riskPct: number; pass: number; fail: number; open: number; medianDays: number | null }
export interface SimInput { rs: number[]; perDay: number[] }

export const MIN_SIM_TRADES = 20

/** R của các lệnh có SL và số lệnh mỗi ngày giao dịch. */
export function simInput(trades: Trade[]): SimInput {
  const rs = trades.map(rMultiple).filter((r): r is number => r != null && Number.isFinite(r))
  const byDay = new Map<string, number>()
  for (const t of trades) { const k = dayKey(t.openTime); byDay.set(k, (byDay.get(k) ?? 0) + 1) }
  return { rs, perDay: [...byDay.values()] }
}

/** Sinh số giả ngẫu nhiên có hạt giống: cùng dữ liệu luôn ra cùng kết quả, con số không nhảy mỗi lần mở. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/**
 * Chạy `runs` lần, mỗi lần tối đa `maxDays` ngày giao dịch, bắt đầu từ trạng thái hiện tại.
 * Qua: đạt mục tiêu và đủ số ngày tối thiểu. Rớt: chạm lỗ ngày hoặc sàn lỗ tổng. Còn lại: chưa xong sau `maxDays` ngày.
 */
export function simulate(input: SimInput, cfg: PropConfig, status: Pick<PropStatus, 'balance' | 'tradingDays'> & { peak?: number }, riskPct: number, runs = 2000, maxDays = 60): SimResult {
  const { rs, perDay } = input
  if (rs.length < MIN_SIM_TRADES || !perDay.length) return { riskPct, pass: 0, fail: 0, open: 1, medianDays: null }
  const size = cfg.accountSize
  const target = size + (size * cfg.targetPct) / 100
  const maxLoss = (size * cfg.maxLossPct) / 100
  const unit = (size * riskPct) / 100
  const rand = rng(rs.length * 7919 + perDay.length * 31 + Math.round(riskPct * 100))
  let pass = 0, fail = 0
  const passDays: number[] = []
  for (let run = 0; run < runs; run++) {
    let bal = status.balance, peak = Math.max(size, status.peak ?? status.balance), days = status.tradingDays
    let result: 'pass' | 'fail' | null = null
    for (let d = 1; d <= maxDays && !result; d++) {
      const dayStart = bal
      const limit = cfg.dailyLossPct > 0 ? ((cfg.dailyBase === 'initial' ? size : dayStart) * cfg.dailyLossPct) / 100 : Infinity
      const floor = maxLoss > 0 ? (cfg.maxLossType === 'trailing' ? peak : size) - maxLoss : -Infinity
      const n = perDay[Math.floor(rand() * perDay.length)]
      for (let i = 0; i < n; i++) {
        bal += rs[Math.floor(rand() * rs.length)] * unit
        if (dayStart - bal >= limit || bal <= floor) { result = 'fail'; break }
      }
      days++
      if (!result && cfg.targetPct > 0 && bal >= target && days >= cfg.minDays) { result = 'pass'; passDays.push(d) }
      peak = Math.max(peak, bal)
    }
    if (result === 'pass') pass++
    else if (result === 'fail') fail++
  }
  passDays.sort((a, b) => a - b)
  return { riskPct, pass: pass / runs, fail: fail / runs, open: (runs - pass - fail) / runs, medianDays: passDays.length ? passDays[Math.floor(passDays.length / 2)] : null }
}

/** Các mức rủi ro để so sánh, gồm mức người dùng đang đặt. */
export function riskLevels(current: number): number[] {
  return [...new Set([0.25, 0.5, 1, 1.5, 2, current].map((x) => Math.round(x * 100) / 100))].filter((x) => x > 0).sort((a, b) => a - b)
}
