import { useMemo, useState } from 'react'
import { Field, Num, Tile } from '../components/Field'
import { money, signed } from '../lib/format'
import { evaluateProp, PRESETS, suggestProp, type PropConfig } from '../lib/prop'
import { usePersistent } from '../lib/store'
import type { InfoMap } from '../lib/accounts'
import type { BridgeState } from '../lib/bridge'
import { partnerFor, type PartnerLinks } from '../lib/partners'
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

const STATE_TIP: Record<string, string> = { crit: 'Đã vi phạm luật', ok: 'Đã đạt mục tiêu', warn: 'Sắp chạm giới hạn lỗ', on: 'Đang trong giới hạn' }

const STATE = {
  failed: { text: '⛔ Đã vi phạm luật', cls: 'state crit' },
  passed: { text: '✓ Đã đạt mục tiêu', cls: 'state ok' },
  active: { text: '● Đang trong giới hạn', cls: 'state' },
}

/** Khối theo dõi luật cho một tài khoản quỹ. Dùng ở trang Quỹ và ngay dưới tab tài khoản quỹ. */
export function FundPanel({ id: key, allTrades, settings, bridge, infos, links }: { id: string; allTrades: Trade[]; settings: Settings; bridge: BridgeState; infos: InfoMap; links?: PartnerLinks }) {
  const [configs, setConfigs] = usePersistent<Record<string, PropConfig>>('fx.props', {})
  const nowServer = Date.now() + settings.serverOffset * 3_600_000
  const cfg = configs[key] ?? suggestProp(infos[key]?.broker ?? '', infos[key]?.phase ?? '', bridge.accounts.find((a) => a.id === key)?.balance)
  const partner = partnerFor(infos[key]?.broker ?? '')
  const link = partner && links?.[partner.id]
  const setCfg = (c: PropConfig) => setConfigs({ ...configs, [key]: c })
  const trades = allTrades.filter((t) => t.account === key)
  const account = bridge.accounts.find((a) => a.id === key) ?? null
  const set = (p: Partial<PropConfig>) => setCfg({ ...cfg, ...p, preset: 'preset' in p ? p.preset! : 'custom' })
  const ccy = account?.currency ?? infos[key]?.currency ?? settings.accountCcy
  const floating = account?.profit ?? 0
  const s = evaluateProp(trades, cfg, nowServer, floating)
  const drift = account ? account.balance - s.balance : 0

  const riskPerTrade = (s.balance * settings.riskPct) / 100
  const lossesLeft = riskPerTrade > 0 && Number.isFinite(s.room) ? Math.floor(s.room / riskPerTrade + 1e-9) : null

  return (
    <>
      {account ? (
        <p className="notice">
          ✓ Đang đọc trực tiếp tài khoản {account.login}: lãi/lỗ đang treo {signed(floating)} {ccy} đã được tính vào giới hạn.
          {Math.abs(drift) > 1 && ` ⚠ Số dư trên MT5 (${money(account.balance)}) lệch ${signed(drift)} so với Nhật ký; hãy đồng bộ lịch sử ở trang Tài khoản và kiểm tra vốn ban đầu, ngày bắt đầu.`}
        </p>
      ) : (
        <p className="warn">
          ⚠ Tài khoản này chưa kết nối MT5, nên chỉ tính trên lệnh đã đóng. Quỹ tính cả lãi/lỗ đang treo (equity), con số ở đây có thể lạc quan hơn thực tế khi bạn còn lệnh mở.
        </p>
      )}
      <p className="muted small">Thông số mẫu lấy từ các trang đánh giá bên thứ ba, hãy đối chiếu với điều khoản tài khoản của bạn và sửa lại nếu khác.</p>

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

      {partner && link?.url && (s.state !== 'active') && (
        <section className="card partner-cta">
          <div>
            <strong>{s.state === 'failed' ? `Thử lại với ${partner.name}?` : `Qua vòng rồi. Mua thêm tài khoản ${partner.name}?`}</strong>
            <p className="muted small">{link.code ? `Mã giảm giá: ${link.code}. ` : ''}Mua qua link giới thiệu của {infos[key]?.label ? 'bạn' : 'cộng đồng'}.</p>
          </div>
          <a className="button primary" href={link.url} target="_blank" rel="noopener noreferrer">Mở {partner.name}</a>
        </section>
      )}

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

export default function Prop({ trades: allTrades, settings, bridge, infos, goAccounts, links }: { trades: Trade[]; settings: Settings; bridge: BridgeState; infos: InfoMap; goAccounts: () => void; links?: PartnerLinks }) {
  // Chỉ tài khoản có vai trò "Quỹ"; mỗi tài khoản một bộ luật riêng.
  const [configs] = usePersistent<Record<string, PropConfig>>('fx.props', {})
  const propIds = Object.keys(infos).filter((id) => infos[id].role === 'prop')
  const [picked, setPicked] = useState<string | null>(null)
  const key = picked && propIds.includes(picked) ? picked : propIds[0]
  const nowServer = Date.now() + settings.serverOffset * 3_600_000
  const configFor = (id: string) => configs[id] ?? suggestProp(infos[id]?.broker ?? '', infos[id]?.phase ?? '', bridge.accounts.find((a) => a.id === id)?.balance)
  // Trạng thái từng quỹ, để hiện chấm màu trên tab.
  const states = useMemo(() => Object.fromEntries(propIds.map((id) => {
    const live = bridge.accounts.find((a) => a.id === id)
    const st = evaluateProp(allTrades.filter((t) => t.account === id), configFor(id), nowServer, live?.profit ?? 0)
    const tight = Number.isFinite(st.room) && st.dailyLimit > 0 && st.room < st.dailyLimit * 0.4
    return [id, st.state === 'failed' ? 'crit' : st.state === 'passed' ? 'ok' : tight ? 'warn' : 'on']
  })), [propIds.join(), allTrades, configs, bridge.accounts, Math.floor(nowServer / 60000)])

  if (!key) {
    return (
      <>
        <h1>Quỹ</h1>
        <section className="card empty">
          <p>Chưa có tài khoản quỹ nào.</p>
          <p className="muted small">Ở trang Tài khoản, mở tab của tài khoản quỹ và đặt <strong>Vai trò</strong> là “Quỹ”, hoặc thêm tài khoản mới với vai trò đó.</p>
          <button className="primary" onClick={goAccounts}>Sang trang Tài khoản</button>
        </section>
      </>
    )
  }

  return (
    <>
      <h1>Quỹ</h1>
      <div className="tabs" role="tablist" aria-label="Tài khoản quỹ">
        {propIds.map((id) => (
          <button key={id} role="tab" aria-selected={id === key} className={id === key ? 'tab active' : 'tab'} onClick={() => setPicked(id)}>
            <span className={`led st-${states[id]}`} title={STATE_TIP[states[id]]} /> {infos[id].label}
            {(infos[id].broker || infos[id].phase) && <small>{[infos[id].broker, infos[id].phase].filter(Boolean).join(' · ')}</small>}
          </button>
        ))}
      </div>
      <FundPanel key={key} id={key} allTrades={allTrades} settings={settings} bridge={bridge} infos={infos} links={links} />
    </>
  )
}
