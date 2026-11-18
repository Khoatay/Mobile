/** Khoảng thời gian chọn nhanh (1, 3, 7 ngày…) hoặc tự chọn theo lịch. Tính theo ngày của giờ máy chủ. */
export type Period = { kind: 'days'; days: number } | { kind: 'range'; from: string; to: string }

/** 0 = toàn bộ. "1 ngày" là hôm nay (từ 0h giờ máy chủ), "3 ngày" là hôm nay và 2 ngày trước… */
export const PERIOD_PRESETS: [number, string][] = [[1, 'Hôm nay'], [3, '3 ngày'], [7, '7 ngày'], [30, '30 ngày'], [90, '90 ngày'], [365, '1 năm'], [0, 'Toàn bộ']]

const DAY = 86_400_000
const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY
const parseDay = (s: string) => { const t = Date.parse(`${s}T00:00:00Z`); return Number.isFinite(t) ? t : NaN }
export const ymdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** [từ, tới) theo giờ máy chủ (ms), cùng hệ với closeTime của lệnh. */
export function periodBounds(p: Period, nowServer: number): [number, number] {
  if (p.kind === 'days') return p.days > 0 ? [dayStart(nowServer) - (p.days - 1) * DAY, Infinity] : [-Infinity, Infinity]
  const from = parseDay(p.from), to = parseDay(p.to)
  return [Number.isFinite(from) ? from : -Infinity, Number.isFinite(to) ? to + DAY : Infinity]
}

/** Số ngày cần lấy lịch sử từ MT5 để phủ khoảng đã chọn. */
export function periodDays(p: Period, nowServer: number): number {
  const [from] = periodBounds(p, nowServer)
  return Number.isFinite(from) ? Math.max(1, Math.ceil((nowServer - from) / DAY) + 1) : 3650
}

export const inPeriod = (p: Period, nowServer: number) => {
  const [a, b] = periodBounds(p, nowServer)
  return (t: { closeTime: number }) => t.closeTime >= a && t.closeTime < b
}

export function periodLabel(p: Period): string {
  if (p.kind === 'days') return PERIOD_PRESETS.find(([d]) => d === p.days)?.[1] ?? `${p.days} ngày`
  return `${p.from || '…'} → ${p.to || '…'}`
}
