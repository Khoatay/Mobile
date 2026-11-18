/**
 * Lịch sử thi quỹ: mỗi lần mua challenge (hoặc tài khoản instant) là một dòng, kèm các lần rút lợi nhuận.
 * Dùng để biết thật sự lãi hay lỗ khi tính cả phí mua, theo từng quỹ.
 */
export type ChallengeStatus = 'active' | 'passed' | 'funded' | 'failed' | 'refunded'
export const STATUS_TEXT: Record<ChallengeStatus, string> = { active: 'Đang thi', passed: 'Đã qua', funded: 'Đã cấp vốn', failed: 'Rớt', refunded: 'Hoàn phí' }

export interface Challenge {
  id: string
  firm: string
  program: string
  size: number
  /** Phí mua (USD). Với trạng thái "Hoàn phí" vẫn ghi phí, phần hoàn được trừ khi tính. */
  fee: number
  date: string
  status: ChallengeStatus
  /** Số tài khoản MT5 nếu có, để nối với tab Quỹ. */
  account?: string
  payouts: { date: string; amount: number }[]
  note: string
}

export const blankChallenge = (): Challenge => ({ id: `c${Date.now()}`, firm: '', program: '', size: 100000, fee: 0, date: new Date().toISOString().slice(0, 10), status: 'active', payouts: [], note: '' })

export interface FirmSummary { firm: string; bought: number; passed: number; failed: number; active: number; passRate: number | null; fees: number; payouts: number; net: number }

/** Tổng hợp theo quỹ và tổng cộng. Tỷ lệ qua chỉ tính trên các lần đã có kết quả (không tính đang thi). */
export function summarize(list: Challenge[]): { firms: FirmSummary[]; total: FirmSummary } {
  const make = (firm: string, items: Challenge[]): FirmSummary => {
    const passed = items.filter((c) => c.status === 'passed' || c.status === 'funded').length
    const failed = items.filter((c) => c.status === 'failed').length
    const fees = items.reduce((s, c) => s + (c.status === 'refunded' ? 0 : c.fee), 0)
    const payouts = items.reduce((s, c) => s + c.payouts.reduce((a, p) => a + p.amount, 0), 0)
    return { firm, bought: items.length, passed, failed, active: items.filter((c) => c.status === 'active').length, passRate: passed + failed ? passed / (passed + failed) : null, fees, payouts, net: payouts - fees }
  }
  const names = [...new Set(list.map((c) => c.firm.trim() || 'Khác'))].sort((a, b) => a.localeCompare(b, 'vi'))
  return { firms: names.map((n) => make(n, list.filter((c) => (c.firm.trim() || 'Khác') === n))), total: make('Tổng', list) }
}
