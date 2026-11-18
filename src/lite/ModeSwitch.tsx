import type { Mode } from './plain'

/** Công tắc 2 nấc Đơn giản | Đầy đủ, đặt ngay dưới logo ở cả hai bản để luôn thấy. */
export default function ModeSwitch({ mode, onChange, dark }: { mode: Mode; onChange: (m: Mode) => void; dark?: boolean }) {
  return (
    <div className={dark ? 'mode-switch2 dark' : 'mode-switch2'} role="radiogroup" aria-label="Chế độ giao diện">
      {([['lite', 'Đơn giản'], ['full', 'Đầy đủ']] as const).map(([m, label]) => (
        <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'active' : ''} onClick={() => mode !== m && onChange(m)}>
          {label}
        </button>
      ))}
    </div>
  )
}
