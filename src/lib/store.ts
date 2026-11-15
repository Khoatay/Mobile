import { useEffect, useState } from 'react'
import { SAMPLE_QUOTES } from './forex'
import type { Settings, Trade } from './types'

export const DEFAULT_SETTINGS: Settings = {
  accountCcy: 'USD',
  balance: 10000,
  riskPct: 1,
  leverage: 100,
  serverOffset: 2,
  quotes: SAMPLE_QUOTES,
  quotesUpdatedAt: null,
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function usePersistent<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => load(key, fallback))
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* bộ nhớ đầy hoặc bị chặn */ }
  }, [key, value])
  return [value, setValue] as const
}

export function useSettings() {
  const [s, set] = usePersistent<Settings>('fx.settings', DEFAULT_SETTINGS)
  // Gộp với mặc định để bản lưu cũ không thiếu trường mới.
  const merged: Settings = { ...DEFAULT_SETTINGS, ...s, quotes: { ...SAMPLE_QUOTES, ...s.quotes } }
  return [merged, (patch: Partial<Settings>) => set({ ...merged, ...patch })] as const
}

export function useTrades() {
  return usePersistent<Trade[]>('fx.trades', [])
}

/** Gộp lệnh mới, bỏ lệnh trùng id. Trả về số lệnh thực sự được thêm. */
export function mergeTrades(existing: Trade[], incoming: Trade[]): { trades: Trade[]; added: number } {
  const ids = new Set(existing.map((t) => t.id))
  const fresh = incoming.filter((t) => !ids.has(t.id) && ids.add(t.id))
  return { trades: [...existing, ...fresh], added: fresh.length }
}

export function download(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
