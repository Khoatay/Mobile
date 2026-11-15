import { useCallback, useEffect, useState } from 'react'

export const BRIDGE_URL = 'http://127.0.0.1:8787'

export type AccountType = 'real' | 'prop' | 'copy' | 'demo'
export const ACCOUNT_TYPE: Record<AccountType, string> = { real: 'Thật', prop: 'Quỹ', copy: 'Copy (nguồn)', demo: 'Demo' }

/** Thông tin khai báo của một tài khoản trong config.json của bridge, kèm trạng thái kết nối. */
export interface AccountMeta { id: string; label: string; type: AccountType; tradable: boolean; connected: boolean; error: string }

export interface BridgeStatus {
  accounts: AccountMeta[]
  telegram: { connected: boolean; error: string; channels: string[] }
}

export interface LivePosition {
  ticket: number; symbol: string; side: 'buy' | 'sell'; volume: number
  openPrice: number; price: number; sl: number; tp: number; profit: number; swap: number; time: number
}

export interface LiveAccount extends AccountMeta {
  login: number; server: string; name: string; currency: string
  balance: number; equity: number; profit: number; margin: number; marginFree: number; leverage: number
  positions: LivePosition[]
}

/** Deal thô của MT5. type: 0 buy, 1 sell, còn lại là nạp/rút... entry: 0 vào, 1 ra, 2 đảo chiều, 3 đóng bằng lệnh đối ứng. */
export interface Mt5Deal {
  ticket: number; positionId: number; time: number; type: number; entry: number
  symbol: string; volume: number; price: number; commission: number; fee: number; swap: number; profit: number
}
export interface Mt5Order { positionId: number; time: number; sl: number; tp: number }

/** Nến theo giờ máy chủ, t tính bằng giây. */
export interface Candle { t: number; o: number; h: number; l: number; c: number }

export interface TgMessage { channel: string; id: number; date: number; text: string }

export async function bridgeGet<T>(path: string): Promise<T> {
  const res = await fetch(BRIDGE_URL + path, { signal: AbortSignal.timeout(15000) })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? `Lỗi ${res.status}`)
  return body as T
}

export async function bridgePost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BRIDGE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FXDesk': '1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  const out = await res.json()
  if (!res.ok) throw new Error(out?.error ?? `Lỗi ${res.status}`)
  return out as T
}

export interface BridgeState {
  online: boolean
  status: BridgeStatus | null
  /** Mọi tài khoản đã khai báo, kể cả chưa nối được. */
  metas: AccountMeta[]
  /** Chỉ các tài khoản đang kết nối, kèm số liệu trực tiếp. */
  accounts: LiveAccount[]
  refresh: () => void
}

/** Hỏi bridge mỗi 5 giây. Bridge không chạy thì mọi thứ vẫn dùng được với dữ liệu trong Nhật ký. */
export function useBridge(): BridgeState {
  const [state, setState] = useState<Omit<BridgeState, 'refresh'>>({ online: false, status: null, metas: [], accounts: [] })
  const poll = useCallback(async () => {
    try {
      const status = await bridgeGet<BridgeStatus>('/status')
      const all = status.accounts.length ? await bridgeGet<(AccountMeta | LiveAccount)[]>('/accounts').catch(() => status.accounts) : []
      setState({ online: true, status, metas: all, accounts: all.filter((a): a is LiveAccount => a.connected && 'balance' in a) })
    } catch {
      setState((s) => (s.online ? { online: false, status: null, metas: [], accounts: [] } : s))
    }
  }, [])
  useEffect(() => {
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [poll])
  return { ...state, refresh: poll }
}
