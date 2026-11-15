import type { Group } from '../lib/stats'
import { pct, signed } from '../lib/format'

/** Bảng kèm thanh lãi/lỗ quanh trục 0: thanh sang phải là lãi, sang trái là lỗ. */
export default function BarTable({ title, rows, note }: { title: string; rows: Group[]; note?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)))
  const hasPos = rows.some((r) => r.net > 0)
  const hasNeg = rows.some((r) => r.net < 0)
  // Trục 0 nằm giữa khi có cả lãi lẫn lỗ; nếu chỉ một phía thì dồn về mép để thanh dùng hết chiều rộng.
  const zero = hasPos && hasNeg ? 50 : hasNeg ? 100 : 0
  const span = hasPos && hasNeg ? 50 : 100
  return (
    <section className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">Chưa có dữ liệu.</p>
      ) : (
        <table className="bars">
          <thead>
            <tr><th /><th aria-hidden /><th className="num">Lãi/lỗ ròng</th><th className="num">Lệnh</th><th className="num">Thắng</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} title={`${r.key}: ${signed(r.net)} · ${r.n} lệnh · thắng ${pct(r.winRate)}`}>
                <th scope="row">{r.key}</th>
                <td className="bar-cell" aria-hidden>
                  <div className="bar-track" style={{ '--zero': `${zero}%` } as React.CSSProperties}>
                    {r.net !== 0 && (
                      <div
                        className={r.net > 0 ? 'bar pos' : 'bar neg'}
                        style={{ width: `${Math.max((Math.abs(r.net) / max) * span, 0.6)}%` }}
                      />
                    )}
                  </div>
                </td>
                <td className="num strong">{signed(r.net)}</td>
                <td className="num">{r.n}</td>
                <td className="num">{pct(r.winRate, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p className="muted small">{note}</p>}
    </section>
  )
}
