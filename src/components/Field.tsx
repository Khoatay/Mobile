import type { ReactNode } from 'react'

/** `group`: dùng khi bên trong là một nhóm nút, để nhãn không bị gắn nhầm vào nút đầu tiên. */
export function Field({ label, hint, children, group }: { label: string; hint?: string; children: ReactNode; group?: boolean }) {
  const inner = (
    <>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </>
  )
  return group ? <div className="field" role="group" aria-label={label}>{inner}</div> : <label className="field">{inner}</label>
}

export function Num({ value, onChange, step, min }: { value: number; onChange: (v: number) => void; step?: number | 'any'; min?: number }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step ?? 'any'}
      min={min}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(e.target.valueAsNumber)}
    />
  )
}

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  )
}
