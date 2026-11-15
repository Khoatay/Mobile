import { useMemo } from 'react'
import { Field, Num, Tile } from '../components/Field'
import { money, signed } from '../lib/format'
import { DEFAULT_PROP, evaluateProp, PRESETS, type PropConfig } from '../lib/prop'
import { usePersistent } from '../lib/store'
import type { Settings, Trade } from '../lib/types'

function Meter({ label, used, limit, kind, detail }: { label: string; used: number; limit: number; kind: 'loss' | 'gain'; detail: string }) {
  const ratio = limit > 0 ? Math.max(0, Math.min(1, used / limit)) : 0
  const level = kind === 'gain' ? 'ok' : ratio >= 0.85 ? 'crit' : ratio >= 0.6 ? 'warn' : 'ok'
  const flag = kind === 'loss' && level === 'crit' ? '⛔ Sát giới hạn' : kind === 'loss' && level === 'warn' ? '⚠ Cẩn thận' : ''
  return (
    <div className="meter-block">
      <div className="meter-head">
        <span>{label}</span>
        <span className="strong">{(ratio * 100).toFixed(0)}% {flag && <em className={`flag ${level}`}>{flag}</em>}</span>
      </div>
      <div className={`meter ${kind} ${level}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <div style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="muted small">{detail}</div>
    </div>
  )
}

const STATE = {
  failed: { text: '⛔ Đã vi phạm luật', cls: 'state crit' },
  passed: { text: '✓ Đã đạt mục tiêu', cls: 'state ok' },
  active: { text: '● Đang trong giới hạn', cls: 'state' },
}

export default function Prop({ trades, settings }: { trades: Trade[]; settings: Settings }) {
  const [cfg, setCfg] = usePersistent<PropConfig>('fx.prop', DEFAULT_PROP)
  const set = (p: Partial<PropConfig>) => setCfg({ ...cfg, ...p, preset: 'preset' in p ? p.preset! : 'custom' })
  const ccy = settings.accountCcy
  const nowServer = Date.now() + settings.serverOffset * 3_600_000
  const s = useMemo(() => evaluateProp(trades, cfg, nowServer), [trades, cfg, Math.floor(nowServer / 60000)])

  const riskPerTrade = (s.balance * settings.riskPct) / 100
  const lossesLeft = riskPerTrade > 0 && Number.isFinite(s.room) ? Math.floor(s.room / riskPerTrade + 1e-9) : null

  return (
    <>
      <h1>Theo dõi luật quỹ</h1>
      <p className="warn">
        ⚠ Chỉ tính trên lệnh đã đóng trong Nhật ký. Quỹ tính cả lãi/lỗ đang treo (equity), nên con số ở đây có thể lạc quan hơn thực tế khi bạn còn lệnh mở.
        Thông số mẫu lấy từ các trang đánh giá bên thứ ba, hãy đối chiếu với điều khoản tài khoản của bạn và sửa lại nếu khác.
      </p>

      <section className="card">
        <div className="prop-form">
          <Field label="Chương trình">
            <select value={cfg.preset} onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value)
              if (p) setCfg({ ...cfg, ...p.rules, preset: p.id })
            }}>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="custom" disabled={cfg.preset !== 'custom'}>Tuỳ chỉnh</option>
            </select>
          </Field>
          <Field label={`Vốn ban đầu (${ccy})`}><Num value={cfg.accountSize} onChange={(v) => set({ accountSize: v, preset: cfg.preset })} min={0} /></Field>
          <Field label="Tính từ ngày" hint="Trống = mọi lệnh">
            <input type="date" value={cfg.startDate} onChange={(e) => set({ startDate: e.target.value, preset: cfg.preset })} />
          </Field>
          <Field label="Mục tiêu lãi (%)"><Num value={cfg.targetPct} onChange={(v) => set({ targetPct: v })} min={0} /></Field>
          <Field label="Lỗ tối đa trong ngày (%)" hint="0 = không áp dụng"><Num value={cfg.dailyLossPct} onChange={(v) => set({ dailyLossPct: v })} min={0} /></Field>
          <Field label="Lỗ ngày tính trên">
            <select value={cfg.dailyBase} onChange={(e) => set({ dailyBase: e.target.value as PropConfig['dailyBase'] })}>
              <option value="initial">Vốn ban đầu</option><option value="dayStart">Số dư đầu ngày</option>
            </select>
          </Field>
          <Field label="Lỗ tối đa tổng (%)"><Num value={cfg.maxLossPct} onChange={(v) => set({ maxLossPct: v })} min={0} /></Field>
          <Field label="Kiểu lỗ tổng">
            <select value={cfg.maxLossType} onChange={(e) => set({ maxLossType: e.target.value as PropConfig['maxLossType'] })}>
              <option value="static">Cố định từ vốn ban đầu</option><option value="trailing">Trailing theo đỉnh cuối ngày</option>
            </select>
          </Field>
          <Field label="Số ngày giao dịch tối thiểu"><Num value={cfg.minDays} onChange={(v) => set({ minDays: v })} min={0} /></Field>
        </div>
      </section>

      <div className="tiles wide">
        <Tile label="Trạng thái" value={<span className={STATE[s.state].cls}>{STATE[s.state].text}</span>}
          sub={s.breaches.length ? s.breaches[0] + (s.breaches.length > 1 ? ` (+${s.breaches.length - 1})` : '') : `Số dư ${money(s.balance, ccy)} · ${signed(s.pnl)} từ đầu`} />
        <Tile label="Còn được lỗ hôm nay" value={Number.isFinite(s.room) ? money(s.room, ccy) : 'Không giới hạn'}
          sub={lossesLeft == null ? `Ngày máy chủ ${s.today}` : `≈ ${lossesLeft} lệnh thua ở mức rủi ro ${settings.riskPct}% (${money(riskPerTrade)})`} />
        <Tile label="Ngày giao dịch" value={cfg.minDays > 0 ? `${s.tradingDays} / ${cfg.minDays}` : String(s.tradingDays)}
          sub={s.daysLeftToMin > 0 ? `Cần thêm ${s.daysLeftToMin} ngày` : 'Đã đủ số ngày tối thiểu'} />
      </div>

      <section className="card meters">
        {cfg.targetPct > 0 && (
          <Meter kind="gain" label="Tiến độ mục tiêu lãi" used={Math.max(0, s.pnl)} limit={s.target}
            detail={`${signed(s.pnl)} / ${money(s.target, ccy)} · còn thiếu ${money(Math.max(0, s.target - s.pnl), ccy)}`} />
        )}
        {cfg.dailyLossPct > 0 && (
          <Meter kind="loss" label={`Lỗ hôm nay (${s.today})`} used={s.dailyUsed} limit={s.dailyLimit}
            detail={`Đã lỗ ${money(s.dailyUsed)} / giới hạn ${money(s.dailyLimit, ccy)} · còn ${money(s.dailyRemaining, ccy)}`} />
        )}
        {cfg.maxLossPct > 0 && (
          <Meter kind="loss" label="Lỗ tổng" used={s.maxLossUsed} limit={s.maxLossLimit}
            detail={`Sàn số dư ${money(s.floor, ccy)} · còn cách ${money(s.totalRemaining, ccy)}`} />
        )}
      </section>

      <section className="card">
        <h3>Theo từng ngày</h3>
        {s.days.length === 0 ? (
          <p className="muted">Chưa có lệnh nào trong khoảng thời gian này. Import lệnh ở trang Nhật ký.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Ngày (máy chủ)</th><th className="num">Lệnh</th><th className="num">Lãi/lỗ ngày</th><th className="num">Giới hạn lỗ ngày</th><th className="num">Số dư cuối ngày</th><th className="num">Sàn số dư</th><th>Vi phạm</th></tr>
              </thead>
              <tbody>
                {[...s.days].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td className="num">{d.trades}</td>
                    <td className="num strong"><span className={d.net > 0 ? 'pip pos' : d.net < 0 ? 'pip neg' : 'pip'} />{signed(d.net)}</td>
                    <td className="num">{d.dailyLimit > 0 ? money(d.dailyLimit) : '–'}</td>
                    <td className="num">{money(d.endBalance)}</td>
                    <td className="num">{money(d.floor)}</td>
                    <td>{d.dailyBreach || d.floorBreach ? `⛔ ${[d.dailyBreach && 'Lỗ ngày', d.floorBreach && 'Lỗ tổng'].filter(Boolean).join(', ')}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
