import { PERIOD_PRESETS, ymdOf, type Period } from '../lib/period'

/** Chọn nhanh 1/3/7/30/90 ngày, 1 năm, toàn bộ, hoặc tự chọn từ ngày nào tới ngày nào. */
export default function PeriodPicker({ value, onChange, nowServer, label = 'Khoảng thời gian' }: { value: Period; onChange: (p: Period) => void; nowServer: number; label?: string }) {
  const sel = value.kind === 'range' ? 'range' : String(value.days)
  return (
    <span className="period-picker">
      <select aria-label={label} value={sel} style={{ width: 'auto' }} onChange={(e) => {
        const v = e.target.value
        onChange(v === 'range' ? { kind: 'range', from: ymdOf(nowServer - 6 * 86_400_000), to: ymdOf(nowServer) } : { kind: 'days', days: Number(v) })
      }}>
        {PERIOD_PRESETS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
        <option value="range">Tự chọn ngày…</option>
      </select>
      {value.kind === 'range' && (
        <>
          <input type="date" aria-label="Từ ngày" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="muted">→</span>
          <input type="date" aria-label="Tới ngày" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </span>
  )
}
