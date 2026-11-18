/**
 * Giá dùng để quy đổi trong Tính lot: lấy tự động từ MT5 (qua bridge) hoặc từ internet,
 * và cho biết cặp đang chọn thực sự cần giá nào.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { bridgeGet } from './bridge'
import { parseSymbol, QUOTE_KEYS } from './forex'
import type { QuoteFrom, Settings } from './types'

export type { QuoteFrom }
export const FROM_TEXT: Record<QuoteFrom, string> = { sample: 'giá mẫu', internet: 'internet', mt5: 'MT5', manual: 'nhập tay' }

/** Ô giá cần cho một đồng tiền: EUR → EURUSD, JPY → USDJPY, XAU → XAUUSD. USD không cần. */
export function quoteKeyFor(ccy: string): string | null {
  if (ccy === 'USD') return null
  const direct = ccy + 'USD', inverse = 'USD' + ccy
  return QUOTE_KEYS.includes(direct) ? direct : QUOTE_KEYS.includes(inverse) ? inverse : null
}

export interface NeededQuote {
  key: string
  /** 'lot': ảnh hưởng giá trị pip nên ảnh hưởng số lot. 'margin': chỉ ảnh hưởng ký quỹ. */
  role: 'lot' | 'margin'
  why: string
}

/** Những giá mà cặp `symbol` cần khi tài khoản dùng `accountCcy`. */
export function neededQuotes(symbol: string, accountCcy: string): NeededQuote[] {
  const info = parseSymbol(symbol)
  if (!info) return []
  const out = new Map<string, NeededQuote>()
  const add = (ccy: string, role: NeededQuote['role'], why: string) => {
    const key = quoteKeyFor(ccy)
    if (!key || (out.get(key)?.role === 'lot')) return
    out.set(key, { key, role, why })
  }
  if (info.quote !== accountCcy) {
    add(info.quote, 'lot', `Lãi/lỗ của ${info.symbol} tính bằng ${info.quote}; cần giá này để đổi ra ${accountCcy}, nên ảnh hưởng số lot.`)
    add(accountCcy, 'lot', `Tài khoản dùng ${accountCcy}; cần giá này để đổi kết quả về ${accountCcy}, nên ảnh hưởng số lot.`)
  }
  if (info.base !== accountCcy) add(info.base, 'margin', `Giá ${info.base} chỉ dùng để tính ký quỹ (tiền sàn giữ khi mở lệnh), không ảnh hưởng số lot.`)
  return [...out.values()].sort((a, b) => (a.role === b.role ? 0 : a.role === 'lot' ? -1 : 1))
}

export const fromOf = (s: Settings, key: string): QuoteFrom => s.quoteFrom?.[key] ?? (s.quotesUpdatedAt == null ? 'sample' : 'manual')

/** Giá từ internet: tiền tệ từ Frankfurter (tham chiếu ECB, cập nhật mỗi ngày làm việc), vàng/bạc từ gold-api.com. */
export async function internetQuotes(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const [fx, xau, xag] = await Promise.allSettled([
    fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,AUD,NZD,JPY,CHF,CAD').then((r) => (r.ok ? r.json() : Promise.reject())),
    fetch('https://api.gold-api.com/price/XAU').then((r) => (r.ok ? r.json() : Promise.reject())),
    fetch('https://api.gold-api.com/price/XAG').then((r) => (r.ok ? r.json() : Promise.reject())),
  ])
  if (fx.status === 'fulfilled') {
    const rates = (fx.value?.rates ?? {}) as Record<string, number>
    for (const c of ['EUR', 'GBP', 'AUD', 'NZD']) if (rates[c] > 0) out[c + 'USD'] = Number((1 / rates[c]).toFixed(5))
    for (const c of ['JPY', 'CHF', 'CAD']) if (rates[c] > 0) out['USD' + c] = Number(rates[c].toFixed(c === 'JPY' ? 3 : 5))
  }
  if (xau.status === 'fulfilled' && xau.value?.price > 0) out.XAUUSD = Number(Number(xau.value.price).toFixed(2))
  if (xag.status === 'fulfilled' && xag.value?.price > 0) out.XAGUSD = Number(Number(xag.value.price).toFixed(3))
  return out
}

/** Giá thời gian thực từ broker qua bridge (giữa bid và ask). */
export async function mt5Quotes(): Promise<Record<string, number>> {
  const p = await bridgeGet<Record<string, { bid: number; ask: number }>>(`/prices?symbols=${QUOTE_KEYS.join(',')}`)
  const out: Record<string, number> = {}
  for (const k of QUOTE_KEYS) if (p[k]) out[k] = Number(((p[k].bid + p[k].ask) / 2).toPrecision(7))
  return out
}

const EVERY = 15 * 60_000

export interface AutoQuotes { busy: boolean; message: string; refresh: () => void }

/**
 * Tự cập nhật giá khi mở app và mỗi 15 phút: ưu tiên MT5, thiếu cặp nào thì lấy internet bù.
 * Ô người dùng nhập tay vẫn bị ghi đè ở lần cập nhật sau (giá cũ thì không còn đúng nữa).
 */
export function useAutoQuotes(patch: (p: (s: Settings) => Partial<Settings>) => void, bridgeOnline: boolean): AutoQuotes {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const running = useRef(false)
  // Có yêu cầu mới trong lúc đang lấy giá (ví dụ bridge vừa nối xong): chạy lại ngay sau lần hiện tại.
  const again = useRef(false)

  const refresh = useCallback(async () => {
    if (running.current) { again.current = true; return }
    running.current = true; setBusy(true)
    const got: Record<string, number> = {}
    const from: Record<string, QuoteFrom> = {}
    if (bridgeOnline) {
      try { for (const [k, v] of Object.entries(await mt5Quotes())) { got[k] = v; from[k] = 'mt5' } } catch { /* bridge chưa nối MT5: dùng internet */ }
    }
    if (QUOTE_KEYS.some((k) => !(k in got))) {
      try { for (const [k, v] of Object.entries(await internetQuotes())) if (!(k in got)) { got[k] = v; from[k] = 'internet' } } catch { /* mất mạng */ }
    }
    const n = Object.keys(got).length
    if (n) patch((s) => ({ quotes: { ...s.quotes, ...got }, quoteFrom: { ...s.quoteFrom, ...from }, quotesUpdatedAt: Date.now() }))
    setMessage(n ? '' : 'Không lấy được giá tự động (mất mạng?). App đang dùng giá lần trước; có thể nhập tay bên dưới.')
    running.current = false; setBusy(false)
    if (again.current) { again.current = false; refreshRef.current() }
  }, [bridgeOnline, patch])
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, EVERY)
    return () => clearInterval(id)
  }, [refresh])

  return { busy, message, refresh }
}
