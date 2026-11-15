import { useEffect, useRef, useState } from 'react'
import { compact, signed } from '../lib/format'

export interface EquityPoint { t: number; v: number }

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const out: number[] = []
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(Math.round(v / step) * step)
  return out
}

const fmtDate = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

/** Lãi/lỗ luỹ kế theo thứ tự lệnh đóng. Điểm 0 là trước lệnh đầu tiên. */
export default function EquityChart({ points, ccy }: { points: EquityPoint[]; ccy: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const H = 280
  const m = { l: 52, r: 76, t: 14, b: 26 }
  const series = [0, ...points.map((p) => p.v)]
  const ticks = niceTicks(Math.min(...series), Math.max(...series))
  const lo = Math.min(ticks[0], ...series)
  const hi = Math.max(ticks[ticks.length - 1], ...series)
  const n = series.length - 1
  const x = (i: number) => m.l + (n ? (i / n) * (width - m.l - m.r) : 0)
  const y = (v: number) => m.t + (1 - (v - lo) / (hi - lo || 1)) * (H - m.t - m.b)
  const line = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area = `${line}L${x(n).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`
  const last = series[n]

  const xTickIdx = n < 1 ? [] : [...new Set([1, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n])].filter((i) => i >= 1)

  const onMove = (e: React.PointerEvent) => {
    const rect = wrap.current!.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = Math.round(((px - m.l) / (width - m.l - m.r)) * n)
    setHover(Math.max(1, Math.min(n, i)))
  }

  const tipLeft = hover == null ? 0 : Math.min(Math.max(x(hover) + 12, 0), width - 190)

  return (
    <div className="chart" ref={wrap} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={H} role="img" aria-label={`Lãi lỗ luỹ kế qua ${n} lệnh, hiện tại ${signed(last)} ${ccy}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{compact(t)}</text>
          </g>
        ))}
        {xTickIdx.map((i, k) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={k === xTickIdx.length - 1 ? 'end' : k === 0 ? 'start' : 'middle'} className="tick">
            {fmtDate(points[i - 1].t)}
          </text>
        ))}
        <path d={area} className="area" />
        <path d={line} className="line" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} className="crosshair" />}
        {hover != null && <circle cx={x(hover)} cy={y(series[hover])} r={5} className="dot" />}
        {n > 0 && (
          <>
            <circle cx={x(n)} cy={y(last)} r={5} className="dot" />
            <text x={x(n) + 10} y={y(last)} dy="0.32em" className="end-label">{signed(last, 0)}</text>
          </>
        )}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: tipLeft, top: m.t }}>
          <div className="tip-value">{signed(series[hover])} {ccy}</div>
          <div className="tip-row"><span className="key" /> Luỹ kế sau lệnh #{hover}</div>
          <div className="tip-row">Lệnh này: {signed(series[hover] - series[hover - 1])}</div>
          <div className="tip-row">{fmtDate(points[hover - 1].t)}</div>
        </div>
      )}
    </div>
  )
}
