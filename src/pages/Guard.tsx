import { useEffect, useMemo, useState } from 'react'
import { Field, Num } from '../components/Field'
import { ask } from '../lib/ask'
import { badges, type InfoMap } from '../lib/accounts'
import { buildGuard, DEFAULT_GUARD_UI, guardChanged, type AutomationSnapshot, type GuardUi } from '../lib/automation'
import { bridgeGet, bridgePost, type BridgeState } from '../lib/bridge'
import { money } from '../lib/format'
import { evaluateProp, suggestProp, type PropConfig } from '../lib/prop'
import { usePersistent } from '../lib/store'
import type { Settings, Trade } from '../lib/types'
import { BridgeSetup } from './Account'

const EVENT_ICON: Record<string, string> = { warn: '⚠️', lock: '⛔', unlock: '🔓', news: '📰', copy: '🔁', 'copy-error': '❗' }
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

function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.max(0, value * 100))
  const lvl = value >= 0.9 ? 'crit' : value >= 0.7 ? 'warn' : 'ok'
  return (
    <div className="meter-block">
      <div className="meter-head"><span>{label}</span><span className="strong">{pct.toFixed(0)}%</span></div>
      <div className={`meter loss ${lvl}`}><div style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

export default function Guard({ bridge, trades, settings, infos }: { bridge: BridgeState; trades: Trade[]; settings: Settings; infos: InfoMap }) {
  const { snap, setSnap, err, load } = useAutomation(bridge.online)
  const [uis, setUis] = usePersistent<Record<string, GuardUi>>('fx.guardui', {})
  const [props] = usePersistent<Record<string, PropConfig>>('fx.props', {})
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const nowServer = Date.now() + settings.serverOffset * 3_600_000

  // Giới hạn hôm nay theo luật quỹ của từng tài khoản quỹ (cùng cách tính với trang Quỹ).
  const propLimits = useMemo(() => Object.fromEntries(bridge.accounts.filter((a) => infos[a.id]?.role === 'prop').map((a) => {
    const cfg = props[a.id] ?? suggestProp(infos[a.id]?.broker ?? '', infos[a.id]?.phase ?? '', a.balance)
    const s = evaluateProp(trades.filter((t) => t.account === a.id), cfg, nowServer, a.profit)
    return [a.id, { dailyLimit: s.dailyLimit, floor: s.floor, maxLossLimit: s.maxLossLimit }]
  })), [bridge.accounts, infos, props, trades, Math.floor(nowServer / 600000)])

  const uiFor = (id: string): GuardUi => uis[id] ?? { ...DEFAULT_GUARD_UI, source: propLimits[id] ? 'prop' : 'custom' }
  const configFor = (id: string) => {
    const a = bridge.accounts.find((x) => x.id === id)
    return buildGuard(uiFor(id), settings.serverOffset, a?.balance ?? 0, propLimits[id])
  }

  const push = async (id: string, enabled?: boolean) => {
    const ui = { ...uiFor(id), ...(enabled != null ? { enabled } : {}) }
    setUis({ ...uis, [id]: ui })
    const a = bridge.accounts.find((x) => x.id === id)
    try {
      setSnap(await bridgePost<AutomationSnapshot>('/automation/guard', { account: id, config: buildGuard(ui, settings.serverOffset, a?.balance ?? 0, propLimits[id]) }))
      setMsg({ ok: true, text: `Đã cập nhật bảo vệ cho ${infos[id]?.label ?? id}.` })
    } catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }

  // Tài khoản lấy giới hạn theo luật quỹ: gửi lại khi giới hạn hôm nay đổi (ví dụ quỹ tính theo số dư đầu ngày).
  useEffect(() => {
    if (!snap) return
    for (const id of Object.keys(snap.guards)) {
      if (uiFor(id).source !== 'prop' || !propLimits[id]) continue
      const next = configFor(id)
      if (guardChanged(snap.guards[id], next)) bridgePost<AutomationSnapshot>('/automation/guard', { account: id, config: next }).then(setSnap).catch(() => {})
    }
  }, [snap?.guards, propLimits])

  const unlock = async (id: string) => {
    if (!(await ask(`Mở khoá vào lệnh cho ${infos[id]?.label ?? id}? Khoá được đặt ra để bảo vệ bạn khỏi chính mình trong lúc nóng đầu.`, 'Vẫn mở khoá', true))) return
    try { setSnap(await bridgePost<AutomationSnapshot>('/automation/unlock', { account: id })) } catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }
  const saveAlerts = async (p: Partial<AutomationSnapshot['alerts']>) => {
    if (!snap) return
    try { setSnap(await bridgePost<AutomationSnapshot>('/automation/alerts', { ...snap.alerts, ...p })) } catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }
  const test = async () => {
    try { await bridgePost('/automation/test', {}); setMsg({ ok: true, text: 'Đã gửi tin nhắn thử vào Saved Messages trên Telegram.' }) }
    catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }

  if (!bridge.online) return (<><h1>Bảo vệ tài khoản</h1><BridgeSetup /></>)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bảo vệ tài khoản</h1>
          <p className="muted">Bridge theo dõi liên tục, kể cả khi app đóng. Chạm ngưỡng thì cảnh báo về điện thoại, đóng hết lệnh và khoá vào lệnh tới hết ngày máy chủ.</p>
        </div>
        <div className="actions">
          <span className={snap?.telegram ? 'chip ok-chip' : 'chip'}>{snap?.telegram ? '● Telegram đã nối' : '○ Telegram chưa nối'}</span>
          <button disabled={!snap?.telegram} onClick={test}>Gửi tin thử</button>
        </div>
      </div>
      {err && <p className="notice bad">⚠ {err}</p>}
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
      {bridge.accounts.length === 0 && <section className="card empty"><p>Chưa có tài khoản MT5 nào đang nối.</p></section>}

      <div className="guards">
        {bridge.accounts.map((a) => {
          const ui = uiFor(a.id)
          const on = !!snap?.guards[a.id]?.enabled
          const st = snap?.states[a.id]
          const lock = snap?.locks[a.id]
          const cfg = configFor(a.id)
          const set = (p: Partial<GuardUi>) => setUis({ ...uis, [a.id]: { ...ui, ...p } })
          return (
            <section key={a.id} className={`card guard${lock ? ' locked' : on ? ' on' : ''}`}>
              <div className="guard-head">
                <div>
                  <h3>{infos[a.id]?.label ?? a.label}</h3>
                  <div className="chips">{infos[a.id] && badges(infos[a.id]).map((b) => <span key={b} className="chip">{b}</span>)}{!a.tradable && <span className="chip">Chỉ cảnh báo (mật khẩu view)</span>}</div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={on} onChange={(e) => push(a.id, e.target.checked)} />
                  <span>{on ? 'Đang bảo vệ' : 'Tắt'}</span>
                </label>
              </div>

              {lock && (
                <div className="lock-banner">
                  <strong>⛔ Đang khoá vào lệnh</strong>
                  <span>{lock.reason}. Mở lại lúc {new Date(lock.until * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}.</span>
                  <button className="ghost mini" onClick={() => unlock(a.id)}>Mở khoá</button>
                </div>
              )}

              {on && st && (
                <>
                  <div className="guard-stats">
                    <div><span className="muted small">Lỗ hôm nay</span><strong>{money(st.day_loss, st.currency)}</strong><span className="muted small">/ {cfg.daily_limit ? money(cfg.daily_limit) : 'không giới hạn'}</span></div>
                    <div><span className="muted small">Equity</span><strong>{money(st.equity, st.currency)}</strong><span className="muted small">sàn {cfg.floor ? money(cfg.floor) : '–'}</span></div>
                    <div><span className="muted small">Thua liên tiếp</span><strong>{st.consec_losses}</strong><span className="muted small">{cfg.max_consec_losses ? `khoá ở ${cfg.max_consec_losses}` : 'không khoá'}</span></div>
                    <div><span className="muted small">Lệnh hôm nay</span><strong>{st.trades}</strong><span className="muted small">{cfg.max_trades ? `tối đa ${cfg.max_trades}` : 'không giới hạn'}</span></div>
                  </div>
                  {cfg.daily_limit > 0 && <Meter value={st.used} label="Đã dùng giới hạn lỗ ngày" />}
                  {cfg.floor > 0 && <Meter value={st.floor_used} label="Đã dùng giới hạn lỗ tổng" />}
                  {st.error && <p className="notice bad">⚠ {st.error}</p>}
                </>
              )}

              <details className="guide" open={open === a.id} onToggle={(e) => { const isOpen = (e.target as HTMLDetailsElement).open; setOpen((cur) => (isOpen ? a.id : cur === a.id ? null : cur)) }}>
                <summary>Cài đặt</summary>
                <div className="prop-form" style={{ marginTop: 10 }}>
                  <Field label="Giới hạn lấy từ">
                    <select value={ui.source} onChange={(e) => set({ source: e.target.value as GuardUi['source'] })}>
                      <option value="prop" disabled={!propLimits[a.id]}>Luật quỹ của tài khoản{propLimits[a.id] ? '' : ' (chỉ tài khoản quỹ)'}</option>
                      <option value="custom">Tự đặt theo % số dư</option>
                    </select>
                  </Field>
                  {ui.source === 'custom' && <>
                    <Field label="Lỗ tối đa mỗi ngày (% số dư)"><Num value={ui.dailyPct} onChange={(v) => set({ dailyPct: v })} step={0.5} min={0} /></Field>
                    <Field label="Lỗ tối đa tổng (% số dư)" hint="0 = không áp dụng"><Num value={ui.totalPct} onChange={(v) => set({ totalPct: v })} step={0.5} min={0} /></Field>
                  </>}
                  <Field label="Cảnh báo lần 1 (%)"><Num value={ui.warn1} onChange={(v) => set({ warn1: v })} min={0} /></Field>
                  <Field label="Cảnh báo lần 2 (%)"><Num value={ui.warn2} onChange={(v) => set({ warn2: v })} min={0} /></Field>
                  <Field label="Hành động ở (%)" hint="Đóng lệnh và khoá khi dùng tới mức này"><Num value={ui.actAt} onChange={(v) => set({ actAt: Math.min(100, Math.max(50, v || 95)) })} min={50} /></Field>
                  <Field label="Khoá sau N lệnh thua liên tiếp" hint="0 = không áp dụng"><Num value={ui.maxConsec} onChange={(v) => set({ maxConsec: Math.max(0, Math.round(v || 0)) })} min={0} /></Field>
                  <Field label="Tối đa lệnh mỗi ngày" hint="0 = không áp dụng"><Num value={ui.maxTrades} onChange={(v) => set({ maxTrades: Math.max(0, Math.round(v || 0)) })} min={0} /></Field>
                </div>
                <label className="inline wrap" style={{ marginTop: 10 }}><input type="checkbox" className="check" checked={ui.closeOnBreach} disabled={!a.tradable} onChange={(e) => set({ closeOnBreach: e.target.checked })} /> Đóng hết lệnh khi chạm mức hành động{!a.tradable && ' (cần mật khẩu giao dịch và allow_trading)'}</label>
                <label className="inline wrap"><input type="checkbox" className="check" checked={ui.closeNew} disabled={!a.tradable} onChange={(e) => set({ closeNew: e.target.checked })} /> Đang khoá mà mở lệnh mới từ MT5 thì đóng luôn</label>
                <p className="muted small">Sẽ gửi: lỗ ngày tối đa {cfg.daily_limit ? money(cfg.daily_limit, a.currency) : 'không giới hạn'} · sàn equity {cfg.floor ? money(cfg.floor, a.currency) : 'không áp dụng'} · hành động ở {Math.round(cfg.act_at * 100)}%.</p>
                <button className="primary" onClick={() => push(a.id, true)}>{on ? 'Lưu thay đổi' : 'Bật bảo vệ với cài đặt này'}</button>
              </details>
            </section>
          )
        })}
      </div>

      {snap && (
        <section className="card form">
          <h3>Cảnh báo về điện thoại</h3>
          <p className="muted small">Tin nhắn gửi vào mục Saved Messages của tài khoản Telegram đã đăng nhập ở bridge, nên điện thoại sẽ báo như tin nhắn thường.</p>
          <label className="inline wrap"><input type="checkbox" className="check" checked={snap.alerts.notify} onChange={(e) => saveAlerts({ notify: e.target.checked })} /> Gửi cảnh báo bảo vệ tài khoản lên Telegram</label>
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
