import { useEffect, useMemo, useState } from 'react'
import { Field, Num } from '../components/Field'
import { ask } from '../lib/ask'
import { badges, categoryOf, type InfoMap } from '../lib/accounts'
import { amountOf, buildGuard, dayRefOfPreset, DEFAULT_GUARD_UI, guardChanged, type AutomationSnapshot, type GuardUi } from '../lib/automation'
import type { LiveAccount } from '../lib/bridge'
import { bridgeGet, bridgePost, type BridgeState } from '../lib/bridge'
import { money } from '../lib/format'
import { evaluateProp, suggestProp, type PropConfig } from '../lib/prop'
import { usePersistent } from '../lib/store'
import type { Settings, Trade } from '../lib/types'
import { BridgeSetup } from './Account'

const EVENT_ICON: Record<string, string> = { warn: '⚠️', lock: '⛔', unlock: '🔓', news: '📰', copy: '🔁', 'copy-error': '❗', stop: '🛡️' }
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

export function useAutomation(online: boolean) {
  const [snap, setSnap] = useState<AutomationSnapshot | null>(null)
  const [err, setErr] = useState('')
  const load = () => bridgeGet<AutomationSnapshot>('/automation').then((s) => { setSnap(s); setErr('') }).catch((e) => setErr(errText(e)))
  useEffect(() => {
    if (!online) return
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [online])
  return { snap, setSnap, err, load }
}

function Meter({ value, label, detail, gain }: { value: number; label: string; detail?: string; gain?: boolean }) {
  const pct = Math.min(100, Math.max(0, value * 100))
  const lvl = gain ? 'ok' : value >= 0.9 ? 'crit' : value >= 0.7 ? 'warn' : 'ok'
  return (
    <div className="meter-block">
      <div className="meter-head"><span>{label}</span><span className="strong">{pct.toFixed(0)}%</span></div>
      <div className={`meter ${gain ? 'gain' : 'loss'} ${lvl}`}><div style={{ width: `${pct}%` }} /></div>
      {detail && <div className="muted small">{detail}</div>}
    </div>
  )
}

/** Ô nhập một mức theo % số dư hoặc theo số tiền, kèm số tiền quy ra. */
function LimitInput({ label, tone, mode, value, balance, ccy, onChange, hint }: { label: string; tone: 'sl' | 'tp'; mode: 'pct' | 'money'; value: number; balance: number; ccy: string; onChange: (p: { mode?: 'pct' | 'money'; value?: number }) => void; hint: string }) {
  const amount = amountOf(mode, value, balance)
  return (
    <Field group label={label} tone={tone} hint={value > 0 ? `= ${money(amount, ccy)}${mode === 'money' ? ` (${((amount / Math.max(1, balance)) * 100).toFixed(1)}% số dư)` : ''}` : hint}>
      <div className="limit-input">
        <Num value={value} onChange={(v) => onChange({ value: v })} min={0} step={mode === 'pct' ? 0.5 : 10} />
        <div className="seg">
          <button className={mode === 'pct' ? 'active' : ''} aria-pressed={mode === 'pct'} onClick={() => onChange({ mode: 'pct' })}>%</button>
          <button className={mode === 'money' ? 'active' : ''} aria-pressed={mode === 'money'} onClick={() => onChange({ mode: 'money' })}>{ccy}</button>
        </div>
      </div>
    </Field>
  )
}

export default function Guard({ bridge, trades, settings, infos }: { bridge: BridgeState; trades: Trade[]; settings: Settings; infos: InfoMap }) {
  const { snap, setSnap, err, load } = useAutomation(bridge.online)
  const [uis, setUis] = usePersistent<Record<string, GuardUi>>('fx.guardui', {})
  const [props] = usePersistent<Record<string, PropConfig>>('fx.props', {})
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const nowServer = Date.now() + settings.serverOffset * 3_600_000
  const serverDay = Math.floor(nowServer / 86_400_000) * 86_400
  const [giveback, setGiveback] = useState<Record<string, number>>({})

  // Giới hạn hôm nay theo luật quỹ của từng tài khoản quỹ (cùng cách tính với trang Quỹ).
  const propLimits = useMemo(() => Object.fromEntries(bridge.accounts.filter((a) => infos[a.id]?.role === 'prop').map((a) => {
    const cfg = props[a.id] ?? suggestProp(infos[a.id]?.broker ?? '', infos[a.id]?.phase ?? '', a.balance)
    const s = evaluateProp(trades.filter((t) => t.account === a.id), cfg, nowServer, a.profit)
    return [a.id, { dailyLimit: s.dailyLimit, floor: s.floor, maxLossLimit: s.maxLossLimit, dayRef: dayRefOfPreset(cfg.preset) }]
  })), [bridge.accounts, infos, props, trades, Math.floor(nowServer / 600000)])

  const isProp = (id: string) => categoryOf(infos[id]) === 'prop'
  // Tài khoản Real/Copy luôn dùng kiểu đơn giản (dừng lỗ, chốt lãi); tài khoản quỹ theo luật quỹ hoặc tự đặt %.
  const uiFor = (id: string): GuardUi => {
    const u: GuardUi = { ...DEFAULT_GUARD_UI, ...(uis[id] ?? {}) }
    if (!isProp(id)) return { ...u, source: 'simple' }
    return { ...u, source: u.source === 'simple' || (!uis[id] && propLimits[id]) ? (propLimits[id] ? 'prop' : 'custom') : u.source }
  }
  const configFor = (id: string) => {
    const a = bridge.accounts.find((x) => x.id === id)
    return buildGuard(uiFor(id), settings.serverOffset, a?.balance ?? 0, propLimits[id])
  }

  const push = async (id: string, enabled?: boolean) => {
    const ui = { ...uiFor(id), ...(enabled != null ? { enabled } : {}) }
    const a = bridge.accounts.find((x) => x.id === id)
    const rule = snap?.rules?.[id]
    const today = rule && rule.day === serverDay
    // Cảnh báo trước khi lưu: đây là lần đặt duy nhất trong ngày.
    if (ui.enabled && snap?.guards[id]?.enabled && !(today && rule.active)) {
      if (!(await ask('Lưu giới hạn cho hôm nay? Mỗi ngày giới hạn lỗ và mục tiêu lãi chỉ đặt được MỘT lần, trước lệnh đầu tiên. Sau khi lưu, hoặc từ lệnh đầu tiên trong ngày, bạn chỉ siết chặt hơn được, không nới ra và không tắt bảo vệ tới hết ngày.', 'Lưu, tôi hiểu', true))) return
    } else if (ui.enabled && !snap?.guards[id]?.enabled) {
      if (!(await ask('Bật bảo vệ? Từ lệnh đầu tiên trong ngày, giới hạn lỗ và mục tiêu lãi chỉ siết chặt hơn được, không nới ra và không tắt bảo vệ tới hết ngày. Ngày nào không đặt lại thì dùng số của hôm trước.', 'Bật, tôi hiểu', true))) return
    }
    setUis({ ...uis, [id]: ui })
    try {
      setSnap(await bridgePost<AutomationSnapshot>('/automation/guard', { account: id, config: buildGuard(ui, settings.serverOffset, a?.balance ?? 0, propLimits[id]) }))
      setMsg({ ok: true, text: `Đã cập nhật bảo vệ cho ${infos[id]?.label ?? id}.` })
    } catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }

  // Gửi lại khi số tiền giới hạn đổi: luật quỹ (giới hạn hôm nay) hoặc mức % số dư của tài khoản Real.
  useEffect(() => {
    if (!snap) return
    for (const id of Object.keys(snap.guards)) {
      const u = uiFor(id)
      // Theo luật quỹ (giới hạn hôm nay có thể đổi), hoặc tài khoản Real đặt theo % số dư (đổi theo số dư).
      const follows = (u.source === 'prop' && propLimits[id]) || (u.source === 'simple' && (u.lossMode === 'pct' || u.profitMode === 'pct'))
      if (!follows || !snap.guards[id].enabled) continue
      const next = configFor(id)
      // auto: bridge giữ số cũ nếu lần gửi này làm nới giới hạn sau lệnh đầu tiên trong ngày.
      if (guardChanged(snap.guards[id], next)) bridgePost<AutomationSnapshot>('/automation/guard', { account: id, config: next, auto: true }).then(setSnap).catch(() => {})
    }
  }, [snap?.guards, propLimits, bridge.accounts])

  const unlock = async (id: string) => {
    if (!(await ask(`Mở khoá vào lệnh cho ${infos[id]?.label ?? id}? Khoá được đặt ra để bảo vệ bạn khỏi chính mình trong lúc nóng đầu.`, 'Vẫn mở khoá', true))) return
    try { setSnap(await bridgePost<AutomationSnapshot>('/automation/unlock', { account: id })) } catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }
  const keepGoing = async (id: string, profit: number, ccy: string) => {
    const g = giveback[id] ?? 0
    if (!(g > 0 && g <= profit)) { setMsg({ ok: false, text: `Số tiền được trả lại phải lớn hơn 0 và không quá số đã lãi (${money(profit, ccy)}).` }); return }
    if (!(await ask(`Trade tiếp? Đây là lượt duy nhất hôm nay. Lãi trong ngày tụt từ ${money(profit, ccy)} về ${money(profit - g, ccy)} thì app đóng hết lệnh và khoá tới hết ngày, không mở lại được nữa.`, 'Trade tiếp', true))) return
    try { setSnap(await bridgePost<AutomationSnapshot>('/automation/continue', { account: id, giveback: g })) } catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }
  const saveAlerts = async (p: Partial<AutomationSnapshot['alerts']>) => {
    if (!snap) return
    try { setSnap(await bridgePost<AutomationSnapshot>('/automation/alerts', { ...snap.alerts, ...p })) } catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }
  const test = async () => {
    try { await bridgePost('/automation/test', {}); setMsg({ ok: true, text: 'Đã gửi tin nhắn thử vào Saved Messages trên Telegram.' }) }
    catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }

  const card = (a: LiveAccount, prop: boolean) => {
    const ui = uiFor(a.id)
    const on = !!snap?.guards[a.id]?.enabled
    const st = snap?.states[a.id]
    const lock = snap?.locks[a.id]
    const nowS = Date.now() / 1000
    const hardUntil = lock?.unlock_at && lock.unlock_at > nowS ? lock.unlock_at : 0
    const hm = (t: number) => new Date(t * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
    const cfg = configFor(a.id)
    const set = (p: Partial<GuardUi>) => setUis({ ...uis, [a.id]: { ...ui, ...p } })
    const ccy = a.currency
    const rule = snap?.rules?.[a.id]
    const ruleToday = rule && rule.day === serverDay ? rule : null
    const frozen = on && !!ruleToday?.active
    return (
      <section key={a.id} className={`card guard${lock ? ' locked' : on ? ' on' : ''}`}>
        <div className="guard-head">
          <div>
            <h3>{infos[a.id]?.label ?? a.label}</h3>
            <div className="chips">{infos[a.id] && badges(infos[a.id]).map((b) => <span key={b} className="chip">{b}</span>)}{!a.tradable && <span className="chip">Chỉ cảnh báo (mật khẩu view)</span>}</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={on} disabled={on && (!!hardUntil || frozen)} title={on && (hardUntil || frozen) ? 'Hôm nay đã có lệnh: không tắt được tới hết ngày' : undefined} onChange={(e) => push(a.id, e.target.checked)} />
            <span>{on ? 'Đang bảo vệ' : 'Tắt'}</span>
          </label>
        </div>

        {lock && (
          <div className="lock-banner">
            <strong>⛔ Đang khoá</strong>
            <span>{lock.reason}. Tự mở lúc {hm(lock.until)}.{hardUntil >= lock.until ? ' Không mở tay được.' : hardUntil ? ` Mở tay được sau ${hm(hardUntil).split(' ')[0]}.` : ''}</span>
            {!hardUntil && <button className="ghost mini" onClick={() => unlock(a.id)}>Mở khoá</button>}
            {lock.kind === 'profit' && !ruleToday?.continued && (st?.day_profit ?? 0) > 0 && (
              <div className="keep-going">
                <p className="small">Muốn trade tiếp? Được <strong>một lần</strong> hôm nay. Chọn số tiền bạn chấp nhận trả lại, tối đa bằng số đã lãi ({money(st!.day_profit!, ccy)}). Lãi tụt quá mức đó thì app đóng hết lệnh và khoá tới hết ngày.</p>
                <div className="actions">
                  <Num value={giveback[a.id] ?? 0} onChange={(v) => setGiveback({ ...giveback, [a.id]: v })} min={0} step={1} />
                  <button className="mini" onClick={() => keepGoing(a.id, st!.day_profit!, ccy)}>Trade tiếp</button>
                </div>
              </div>
            )}
          </div>
        )}
        {ruleToday?.continued && ruleToday.protect != null && !lock && (
          <p className="notice">🔒 Đang trade tiếp sau chốt lời: lãi hôm nay phải giữ ít nhất <strong>{money(ruleToday.protect, ccy)}</strong> (đã lãi {money(ruleToday.continued_from, ccy)}). Tụt xuống dưới là đóng hết lệnh, khoá tới hết ngày.</p>
        )}
        {on && (
          <p className={frozen ? 'rule-line frozen' : 'rule-line'}>
            {frozen
              ? `🔐 Đã có lệnh hôm nay${ruleToday?.active_at ? ` (từ ${new Date(ruleToday.active_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})` : ''}: giới hạn chỉ siết chặt hơn được, không nới, không tắt tới hết ngày.`
              : ruleToday?.set_loss || ruleToday?.set_profit
                ? '✏️ Hôm nay đã đặt giới hạn: từ giờ chỉ siết chặt hơn được. Từ lệnh đầu tiên sẽ khoá luôn tới hết ngày.'
                : '✏️ Chưa có lệnh hôm nay: còn đặt giới hạn được một lần. Không đặt thì dùng số của hôm trước.'}
          </p>
        )}

        {on && st && (
          <>
            {prop ? (
              <div className="guard-stats">
                <div><span className="muted small">Lỗ hôm nay</span><strong>{money(st.day_loss, st.currency)}</strong><span className="muted small">/ {cfg.daily_limit ? money(cfg.daily_limit) : '–'}</span></div>
                <div><span className="muted small">Equity</span><strong>{money(st.equity, st.currency)}</strong><span className="muted small">sàn {cfg.floor ? money(cfg.floor) : '–'}</span></div>
                <div><span className="muted small">Thua liên tiếp</span><strong>{st.consec_losses}</strong><span className="muted small">{cfg.max_consec_losses ? `khoá ở ${cfg.max_consec_losses}` : 'tắt'}</span></div>
                <div><span className="muted small">Lệnh hôm nay</span><strong>{st.trades}</strong><span className="muted small">{cfg.max_trades ? `tối đa ${cfg.max_trades}` : 'tắt'}</span></div>
              </div>
            ) : null}
            {cfg.daily_limit > 0 && <Meter value={st.used} label={prop ? 'Lỗ ngày' : 'Lỗ hôm nay'} detail={`${money(st.day_loss, st.currency)} / ${money(cfg.daily_limit, st.currency)}`} />}
            {!prop && (cfg.profit_limit ?? 0) > 0 && <Meter gain value={st.profit_used ?? 0} label="Lãi hôm nay" detail={`${money(st.day_profit ?? 0, st.currency)} / ${money(cfg.profit_limit!, st.currency)}`} />}
            {cfg.floor > 0 && <Meter value={st.floor_used} label="Lỗ tổng" detail={`Equity ${money(st.equity, st.currency)} · sàn ${money(cfg.floor, st.currency)}`} />}
            {st.stops?.on && st.positions > 0 && (
              <p className="stops-line">🛡️ SL khẩn cấp: {st.stops.protected}/{st.positions} lệnh có SL. Nếu cùng chạm, lỗ thêm tối đa {money(st.stops.budget, st.currency)}.{st.stops.over.length > 0 && <span className="neg"> {st.stops.over.join(', ')} đã lỗ quá mức: sẽ đóng khi chạm giới hạn.</span>}</p>
            )}
            {st.ref_ok === false && <p className="notice">ⓘ Chưa biết equity đầu ngày (bridge không chạy lúc 0h), hôm nay tạm tính lỗ ngày theo số dư đầu ngày.</p>}
            {st.error && <p className="notice bad">⚠ {st.error}</p>}
          </>
        )}

        {!prop ? (
          <div className="guard-simple">
            <div className="prop-form">
              <LimitInput label="Dừng khi lỗ trong ngày" tone="sl" mode={ui.lossMode} value={ui.lossValue} balance={a.balance} ccy={ccy} hint="0 = không dừng lỗ" onChange={(p) => set({ ...(p.mode ? { lossMode: p.mode } : {}), ...(p.value != null ? { lossValue: p.value } : {}) })} />
              <LimitInput label="Dừng khi lãi trong ngày" tone="tp" mode={ui.profitMode} value={ui.profitValue} balance={a.balance} ccy={ccy} hint="0 = không chốt lãi" onChange={(p) => set({ ...(p.mode ? { profitMode: p.mode } : {}), ...(p.value != null ? { profitValue: p.value } : {}) })} />
            </div>
            {!a.tradable && <p className="muted small">Tài khoản dùng mật khẩu view: app chỉ báo, bạn tự đóng lệnh.</p>}
            <button className="primary" onClick={() => push(a.id, true)}>{on ? 'Lưu' : 'Bật bảo vệ'}</button>
          </div>
        ) : (
          <details className="guide" open={open === a.id} onToggle={(e) => { const isOpen = (e.target as HTMLDetailsElement).open; setOpen((cur) => (isOpen ? a.id : cur === a.id ? null : cur)) }}>
            <summary>Cài đặt</summary>
            <div className="prop-form" style={{ marginTop: 10 }}>
              <Field label="Giới hạn theo">
                <select value={ui.source} onChange={(e) => set({ source: e.target.value as GuardUi['source'] })}>
                  <option value="prop" disabled={!propLimits[a.id]}>Luật quỹ</option>
                  <option value="custom">Tự đặt (% số dư)</option>
                </select>
              </Field>
              {ui.source === 'custom' && <>
                <Field label="Lỗ ngày tối đa (%)"><Num value={ui.dailyPct} onChange={(v) => set({ dailyPct: v })} step={0.5} min={0} /></Field>
                <Field label="Lỗ tổng tối đa (%)" hint="0 = tắt"><Num value={ui.totalPct} onChange={(v) => set({ totalPct: v })} step={0.5} min={0} /></Field>
                <Field label="Lỗ ngày tính từ">
                  <select value={ui.dayRef} onChange={(e) => set({ dayRef: e.target.value as GuardUi['dayRef'] })}>
                    <option value="balance">Số dư đầu ngày</option>
                    <option value="higher">Số dư hoặc equity đầu ngày, số nào cao hơn</option>
                  </select>
                </Field>
              </>}
              <Field label="Báo lần 1 ở (%)"><Num value={ui.warn1} onChange={(v) => set({ warn1: v })} min={0} /></Field>
              <Field label="Báo lần 2 ở (%)"><Num value={ui.warn2} onChange={(v) => set({ warn2: v })} min={0} /></Field>
              <Field label="Đóng lệnh + khoá ở (%)"><Num value={ui.actAt} onChange={(v) => set({ actAt: Math.min(100, Math.max(50, v || 95)) })} min={50} /></Field>
              <Field label="Khoá khi thua liên tiếp" hint="Số lệnh. 0 = tắt"><Num value={ui.maxConsec} onChange={(v) => set({ maxConsec: Math.max(0, Math.round(v || 0)) })} min={0} /></Field>
              <Field label="Tối đa lệnh/ngày" hint="0 = tắt"><Num value={ui.maxTrades} onChange={(v) => set({ maxTrades: Math.max(0, Math.round(v || 0)) })} min={0} /></Field>
            </div>
            <div className="guard-toggles">
              <label className="inline"><input type="checkbox" className="check" checked={ui.closeOnBreach} disabled={!a.tradable} onChange={(e) => set({ closeOnBreach: e.target.checked })} /> Đóng hết lệnh khi chạm</label>
              <label className="inline"><input type="checkbox" className="check" checked={ui.hardStop} disabled={!a.tradable} onChange={(e) => set({ hardStop: e.target.checked })} /> SL khẩn cấp trên sàn <span className="muted small">(vẫn chặn khi tắt máy)</span></label>
              <label className="inline"><input type="checkbox" className="check" checked={ui.hardLock} disabled={!!hardUntil} onChange={(e) => set({ hardLock: e.target.checked })} /> Khoá cứng <span className="muted small">(không mở tay được)</span></label>
              <label className="inline"><input type="checkbox" className="check" checked={ui.closeNew} disabled={!a.tradable} onChange={(e) => set({ closeNew: e.target.checked })} /> Tự đóng lệnh mới khi đang khoá</label>
            </div>
            {!a.tradable && <p className="muted small">Mật khẩu view: app chỉ báo, không đóng lệnh được.</p>}
            <p className="muted small">Lỗ ngày ≤ {cfg.daily_limit ? money(cfg.daily_limit, ccy) : '–'} · sàn {cfg.floor ? money(cfg.floor, ccy) : '–'} · hành động ở {Math.round(cfg.act_at * 100)}%</p>
            <button className="primary" onClick={() => push(a.id, true)}>{on ? 'Lưu' : 'Bật bảo vệ'}</button>
          </details>
        )}
      </section>
    )
  }

  if (!bridge.online) return (<><h1>Bảo vệ tài khoản</h1><BridgeSetup /></>)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bảo vệ tài khoản</h1>
          <p className="muted">Bridge canh tài khoản 24/7, kể cả khi app đóng. Chạm giới hạn: báo Telegram, đóng hết lệnh, khoá tới hết ngày.</p>
          <p className="warn small">⚠ Luật khoá trong ngày: giới hạn lỗ và mục tiêu lãi chỉ đặt <strong>một lần mỗi ngày</strong>, trước lệnh đầu tiên. Từ lệnh đầu tiên, chỉ siết chặt hơn được: không nới, không tắt bảo vệ tới hết ngày. Không đặt thì dùng số của hôm trước. Đạt mục tiêu lãi được <strong>trade tiếp một lần</strong>, với số tiền chấp nhận trả lại không quá số đã lãi.</p>
        </div>
        <div className="actions">
          <span className={snap?.telegram ? 'chip ok-chip' : 'chip'}>{snap?.telegram ? '● Telegram đã nối' : '○ Telegram chưa nối'}</span>
          <button disabled={!snap?.telegram} onClick={test}>Gửi tin thử</button>
        </div>
      </div>
      {err && <p className="notice bad">⚠ {err}</p>}
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
      {bridge.accounts.length === 0 && <section className="card empty"><p>Chưa có tài khoản MT5 nào đang nối.</p></section>}

      {(['real', 'prop'] as const).map((group) => {
        const list = bridge.accounts.filter((a) => (group === 'prop') === isProp(a.id))
        if (!list.length) return null
        return (
          <div key={group} className="guard-group">
            <h2 className="section-title">{group === 'prop' ? 'Tài khoản quỹ' : 'Tài khoản Real'}</h2>
            <p className="muted small">{group === 'prop' ? 'Giới hạn lấy theo luật quỹ ở tab Quỹ. Chạm mức hành động: đóng hết lệnh, khoá tới hết ngày.' : 'Đặt mức dừng lỗ và chốt lãi trong ngày. Chạm một trong hai: đóng hết lệnh, khoá tới hết ngày. Báo Telegram khi lỗ tới 70% và 90% mức dừng.'}</p>
            <div className="guards">{list.map((a) => card(a, group === 'prop'))}</div>
          </div>
        )
      })}

      {snap && (
        <section className="card form">
          <h3>Cảnh báo về điện thoại</h3>
          <p className="muted small">Gửi qua Telegram (cài đặt ở trang Hồ sơ).</p>
          <label className="inline wrap"><input type="checkbox" className="check" checked={snap.alerts.notify} onChange={(e) => saveAlerts({ notify: e.target.checked })} /> Gửi cảnh báo bảo vệ lên Telegram</label>
          <label className="inline wrap"><input type="checkbox" className="check" checked={snap.alerts.news} onChange={(e) => saveAlerts({ news: e.target.checked })} /> Báo trước tin mạnh của đồng tiền đang có lệnh mở</label>
          <div className="row" style={{ maxWidth: 320 }}><Field label="Báo trước (phút)"><Num value={snap.alerts.minutes} onChange={(v) => saveAlerts({ minutes: v })} min={5} /></Field></div>
        </section>
      )}

      {snap && snap.events.length > 0 && (
        <section className="card">
          <h3>Nhật ký tự động</h3>
          <ul className="events">
            {snap.events.slice(0, 40).map((e, i) => (
              <li key={i} className={`ev-${e.kind}`}><span aria-hidden="true">{EVENT_ICON[e.kind] ?? '•'}</span><span className="muted small nowrap">{new Date(e.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span><strong>{e.label}</strong><span>{e.text}</span></li>
            ))}
          </ul>
          <button className="ghost mini" onClick={load}>Tải lại</button>
        </section>
      )}
      <p className="muted small">Bridge phải chạy liên tục (trên máy luôn bật hoặc VPS) thì bảo vệ mới có tác dụng. Thử trên tài khoản demo trước khi bật cho tài khoản quỹ.</p>
    </>
  )
}
