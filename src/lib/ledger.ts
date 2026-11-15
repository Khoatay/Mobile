import type { Mt5Deal } from './bridge'

/** out: tiền bạn bỏ ra. in: tiền bạn thu về. */
export type Flow = 'out' | 'in'

export interface LedgerEntry {
  id: string
  /** yyyy-mm-dd */
  date: string
  flow: Flow
  category: string
  /** Luôn dương; chiều do `flow` quyết định. */
  amount: number
  note?: string
  account?: string
}

export const CATEGORIES: Record<Flow, { id: string; label: string }[]> = {
  out: [
    { id: 'prop_fee', label: 'Phí mua quỹ' },
    { id: 'deposit', label: 'Nạp tài khoản thật' },
    { id: 'tools', label: 'Công cụ (TradingView, VPS…)' },
    { id: 'education', label: 'Khoá học, tài liệu' },
    { id: 'other_out', label: 'Chi khác' },
  ],
  in: [
    { id: 'prop_payout', label: 'Rút từ quỹ' },
    { id: 'withdraw', label: 'Rút từ tài khoản thật' },
    { id: 'backcom', label: 'Backcom / rebate' },
    { id: 'affiliate', label: 'Affiliate' },
    { id: 'other_in', label: 'Thu khác' },
  ],
}

export const categoryLabel = (id: string) => [...CATEGORIES.out, ...CATEGORIES.in].find((c) => c.id === id)?.label ?? id

export interface LedgerSummary {
  out: number
  in: number
  /** Dòng tiền ròng: thu về trừ bỏ ra. */
  net: number
  /** Tiền còn nằm trong các tài khoản thật (nếu đọc được từ MT5). */
  held: number
  /** Lãi/lỗ tổng = dòng tiền ròng + tiền còn trong tài khoản. */
  total: number
  /** Tỷ suất trên tổng tiền đã bỏ ra; null nếu chưa bỏ ra đồng nào. */
  roi: number | null
  byCategory: { id: string; label: string; flow: Flow; amount: number; n: number }[]
  byMonth: { month: string; in: number; out: number; net: number; cum: number }[]
}

export function summarize(entries: LedgerEntry[], held = 0): LedgerSummary {
  let out = 0, inn = 0
  const cats = new Map<string, LedgerSummary['byCategory'][number]>()
  const months = new Map<string, { in: number; out: number }>()
  for (const e of entries) {
    if (e.flow === 'out') out += e.amount
    else inn += e.amount
    const c = cats.get(e.category) ?? { id: e.category, label: categoryLabel(e.category), flow: e.flow, amount: 0, n: 0 }
    c.amount += e.amount
    c.n++
    cats.set(e.category, c)
    const key = e.date.slice(0, 7)
    const m = months.get(key) ?? { in: 0, out: 0 }
    m[e.flow] += e.amount
    months.set(key, m)
  }
  let cum = 0
  const byMonth = [...months.keys()].sort().map((month) => {
    const m = months.get(month)!
    cum += m.in - m.out
    return { month, in: m.in, out: m.out, net: m.in - m.out, cum }
  })
  const net = inn - out
  const total = net + held
  return {
    out, in: inn, net, held, total,
    roi: out > 0 ? total / out : null,
    byCategory: [...cats.values()].sort((a, b) => (a.flow === b.flow ? b.amount - a.amount : a.flow === 'out' ? -1 : 1)),
    byMonth,
  }
}

/**
 * Lệnh nạp/rút trong lịch sử MT5 (deal loại 2) -> dòng thu chi. Nạp là tiền bỏ ra, rút là tiền thu về.
 * MT5 cũng ghi một số điều chỉnh khác (thưởng, phí) dưới dạng này, nên người dùng cần xem lại sau khi nhập.
 */
export function balanceDealsToEntries(deals: Mt5Deal[], account: string, label: string): LedgerEntry[] {
  return deals
    .filter((d) => d.type === 2 && d.profit !== 0)
    .map((d) => ({
      id: `mt5:${account}:${d.ticket}`,
      date: new Date(d.time * 1000).toISOString().slice(0, 10),
      flow: d.profit > 0 ? ('out' as const) : ('in' as const),
      category: d.profit > 0 ? 'deposit' : 'withdraw',
      amount: Math.abs(d.profit),
      note: `Tự nhập từ MT5 (${label})`,
      account,
    }))
}

export function ledgerCsv(entries: LedgerEntry[]): string {
  const q = (s: string | number | undefined) => { const t = String(s ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  return ['date,flow,category,amount,account,note', ...entries.map((e) => [e.date, e.flow === 'out' ? 'chi' : 'thu', categoryLabel(e.category), e.amount, e.account, e.note].map(q).join(','))].join('\n') + '\n'
}
