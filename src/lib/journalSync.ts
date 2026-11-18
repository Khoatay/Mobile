/**
 * Tự đưa lịch sử lệnh của các tài khoản đã kết nối vào Nhật ký: lần đầu đọc toàn bộ, sau đó mỗi 5 phút đọc phần mới.
 * Không đọc tài khoản Only view (của người khác). Lệnh trùng (cùng tài khoản, cùng position) bị bỏ qua.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { bridgeGet, type BridgeState, type Mt5Deal, type Mt5Order } from './bridge'
import { dealsToTrades } from './mt5deals'
import { mergeTrades, usePersistent } from './store'
import type { Trade } from './types'

const DAY = 86_400_000
const EVERY = 5 * 60_000

export interface SyncStatus { busy: boolean; at: number | null; added: number; errors: string[]; accounts: number }

/** Số ngày cần đọc lại: lần đầu toàn bộ (10 năm), sau đó từ lần trước, lùi 2 ngày cho chắc. */
export const daysToFetch = (last: number | undefined, now: number) => (last ? Math.min(3650, Math.ceil((now - last) / DAY) + 2) : 3650)

export function useJournalSync(bridge: BridgeState, trades: Trade[], setTrades: Dispatch<SetStateAction<Trade[]>>) {
  const [last, setLast] = usePersistent<Record<string, number>>('fx.journalSync', {})
  const [status, setStatus] = useState<SyncStatus>({ busy: false, at: null, added: 0, errors: [], accounts: 0 })
  const running = useRef(false)
  const lastRef = useRef(last)
  // Danh sách lệnh mới nhất, để đếm đúng số lệnh thật sự được thêm.
  const tradesRef = useRef(trades)
  tradesRef.current = trades
  lastRef.current = last
  const ids = bridge.accounts.map((a) => a.id).join(',')

  const sync = useCallback(async () => {
    if (running.current || !ids) return
    running.current = true
    setStatus((s) => ({ ...s, busy: true }))
    const now = Date.now()
    let added = 0
    const errors: string[] = []
    const done: Record<string, number> = {}
    for (const id of ids.split(',')) {
      try {
        const h = await bridgeGet<{ deals: Mt5Deal[]; orders: Mt5Order[] }>(`/history?days=${daysToFetch(lastRef.current[id], now)}&account=${id}`)
        const fresh = dealsToTrades(h.deals, h.orders, id)
        const m = mergeTrades(tradesRef.current, fresh)
        if (m.added) {
          added += m.added
          tradesRef.current = m.trades
          // Gộp vào bản mới nhất của state (người dùng có thể vừa sửa ghi chú, setup).
          setTrades((prev) => mergeTrades(prev, fresh).trades)
        }
        done[id] = now
      } catch (e) { errors.push(`${id}: ${e instanceof Error ? e.message : 'lỗi'}`) }
    }
    setLast((l) => ({ ...l, ...done }))
    setStatus({ busy: false, at: now, added, errors, accounts: ids.split(',').length })
    running.current = false
  }, [ids, setTrades, setLast])

  useEffect(() => {
    if (!bridge.online || !ids) return
    sync()
    const t = setInterval(sync, EVERY)
    return () => clearInterval(t)
  }, [bridge.online, ids, sync])

  return { status, sync }
}
