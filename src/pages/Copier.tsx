import { useEffect, useState } from 'react'
import { Field, Num } from '../components/Field'
import { ask } from '../lib/ask'
import { isView, type InfoMap } from '../lib/accounts'
import { copyVolume, type AutomationSnapshot, type CopierConfig, type CopyFollower } from '../lib/automation'
import { bridgePost, type BridgeState } from '../lib/bridge'
import { BridgeSetup } from './Account'
import { useAutomation } from './Guard'

const MODE_TEXT = { multiplier: 'Nhân khối lượng nguồn', balance: 'Theo tỷ lệ số dư', fixed: 'Lot cố định' }
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

/** `presetMaster`: mở từ trang Tài khoản (nút "Copy lệnh của người này"), chọn sẵn tài khoản nguồn. */
export default function Copier({ bridge, infos, presetMaster = '', onPresetUsed }: { bridge: BridgeState; infos: InfoMap; presetMaster?: string; onPresetUsed?: () => void }) {
  const { snap, setSnap, err } = useAutomation(bridge.online)
  const [cfg, setCfg] = useState<CopierConfig | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { if (snap && !cfg) setCfg(snap.copier) }, [snap])
  useEffect(() => {
    if (!cfg || !presetMaster) return
    if (cfg.master !== presetMaster) {
      setCfg({ ...cfg, master: presetMaster, followers: cfg.followers.filter((f) => f.account !== presetMaster) })
      setMsg({ ok: true, text: `Đã chọn "${infos[presetMaster]?.label ?? presetMaster}" làm tài khoản nguồn. Thêm tài khoản nhận của bạn rồi bấm Bật copy lệnh.` })
    }
    onPresetUsed?.()
  }, [cfg, presetMaster])
  const name = (id: string) => infos[id]?.label ?? id
  const accounts = bridge.accounts

  if (!bridge.online) return (<><h1>Copy lệnh</h1><BridgeSetup /></>)
  if (!cfg) return (<><h1>Copy lệnh</h1>{err ? <p className="notice bad">⚠ {err}</p> : <p className="muted">Đang tải…</p>}</>)

  const master = accounts.find((a) => a.id === cfg.master)
  const running = !!snap?.copier.enabled
  const dirty = JSON.stringify(cfg) !== JSON.stringify({ ...snap?.copier, enabled: cfg.enabled })
  const setF = (i: number, p: Partial<CopyFollower>) => setCfg({ ...cfg, followers: cfg.followers.map((f, j) => (j === i ? { ...f, ...p } : f)) })

  const save = async (enabled: boolean) => {
    if (enabled && !running && !(await ask(`Bật copy lệnh từ "${master ? name(master.id) : '?'}" sang ${cfg.followers.length} tài khoản? Lệnh mở từ giờ trên tài khoản nguồn sẽ được chép thật.`, 'Bật copy'))) return
    try {
      const s = await bridgePost<AutomationSnapshot>('/automation/copier', { config: { ...cfg, enabled } })
      setSnap(s); setCfg(s.copier)
      setMsg({ ok: true, text: enabled ? 'Copy lệnh đang chạy.' : 'Đã lưu. Copy lệnh đang tắt.' })
    } catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }

  const sampleVol = 1
  const events = snap?.events.filter((e) => e.kind === 'copy' || e.kind === 'copy-error') ?? []
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Copy lệnh</h1>
          <p className="muted">Vào lệnh trên một tài khoản, bridge chép sang các tài khoản còn lại trong vòng vài giây: mở, đóng, SL và TP.</p>
        </div>
        <span className={running ? 'chip ok-chip' : 'chip'}>{running ? '● Đang chạy' : '○ Đang tắt'}</span>
      </div>
      {err && <p className="notice bad">⚠ {err}</p>}
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
      {snap?.copyState.error && running && <p className="notice bad">⚠ {snap.copyState.error}</p>}

      <section className="card">
        <div className="copy-flow">
          <div className="copy-node master">
            <span className="muted small">Tài khoản nguồn</span>
            <select value={cfg.master} onChange={(e) => setCfg({ ...cfg, master: e.target.value, followers: cfg.followers.filter((f) => f.account !== e.target.value) })}>
              <option value="">Chọn…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{name(a.id)}{isView(infos[a.id]) ? ' (Only view)' : ''}</option>)}
            </select>
            {master && <span className="muted small">Số dư {master.balance.toLocaleString('en-US')} {master.currency}</span>}
          </div>
          <span className="copy-arrow" aria-hidden="true">→</span>
          <div className="copy-followers">
            {cfg.followers.map((f, i) => {
              const a = accounts.find((x) => x.id === f.account)
              const vol = master && a ? copyVolume(sampleVol, master.balance, a.balance, f) : null
              return (
                <div key={f.account} className="copy-node">
                  <div className="copy-node-head">
                    <strong>{name(f.account)}</strong>
                    {a && !a.tradable && <span className="chip">Cần bật allow_trading</span>}
                    <button className="ghost icon" aria-label={`Bỏ ${name(f.account)}`} onClick={() => setCfg({ ...cfg, followers: cfg.followers.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                  <div className="row">
                    <Field label="Cách tính lot">
                      <select value={f.mode} onChange={(e) => setF(i, { mode: e.target.value as CopyFollower['mode'] })}>{(Object.keys(MODE_TEXT) as CopyFollower['mode'][]).map((m) => <option key={m} value={m}>{MODE_TEXT[m]}</option>)}</select>
                    </Field>
                    <Field label={f.mode === 'fixed' ? 'Lot' : 'Hệ số'}><Num value={f.value} onChange={(v) => setF(i, { value: v })} step={0.01} min={0} /></Field>
                  </div>
                  <label className="inline"><input type="checkbox" className="check" checked={f.reverse} onChange={(e) => setF(i, { reverse: e.target.checked })} /> Chép ngược chiều (hedge)</label>
                  {vol != null && <span className="muted small">Ví dụ: nguồn vào {sampleVol} lot → tài khoản này vào {vol.toFixed(2)} lot (giới hạn bởi max_lot của tài khoản).</span>}
                </div>
              )
            })}
            <div className="actions">
              <select aria-label="Thêm tài khoản nhận" value="" onChange={(e) => { if (e.target.value) setCfg({ ...cfg, followers: [...cfg.followers, { account: e.target.value, mode: 'balance', value: 1, reverse: false }] }) }} style={{ width: 'auto' }}>
                <option value="">+ Thêm tài khoản nhận…</option>
                {accounts.filter((a) => a.id !== cfg.master && !isView(infos[a.id]) && !cfg.followers.some((f) => f.account === a.id)).map((a) => <option key={a.id} value={a.id}>{name(a.id)}</option>)}
              </select>
            </div>
          </div>
        </div>
        <label className="inline wrap" style={{ marginTop: 12 }}><input type="checkbox" className="check" checked={cfg.copy_sltp} onChange={(e) => setCfg({ ...cfg, copy_sltp: e.target.checked })} /> Chép SL/TP và cập nhật khi tài khoản nguồn dời SL/TP</label>
        <div className="actions" style={{ marginTop: 12 }}>
          {running
            ? <><button className="ghost danger" onClick={() => save(false)}>Tắt copy</button>{dirty && <button className="primary" onClick={() => save(true)}>Lưu thay đổi</button>}</>
            : <button className="primary" disabled={!cfg.master || !cfg.followers.length} onClick={() => save(true)}>Bật copy lệnh</button>}
        </div>
        <ul className="muted small notes">
          <li>Chỉ chép lệnh mở sau khi bật; lệnh đang có sẵn trên tài khoản nguồn bị bỏ qua.</li>
          <li>Tài khoản đang bị Bảo vệ khoá sẽ không nhận lệnh mới.</li>
          <li>Mỗi lệnh chép mang ghi chú <code>FXD#số lệnh nguồn</code>; đừng sửa ghi chú này trên MT5.</li>
          <li>Một số quỹ cấm hoặc giới hạn việc copy lệnh giữa nhiều tài khoản. Đọc điều khoản của quỹ trước khi bật.</li>
          <li>Nguồn là tài khoản Only view (của người khác): chỉ chép khi họ đồng ý chia sẻ. Lệnh chép trễ vài giây so với họ nên giá có thể khác; thử trên tài khoản demo trước.</li>
        </ul>
      </section>

      {events.length > 0 && (
        <section className="card">
          <h3>Hoạt động gần đây</h3>
          <ul className="events">
            {events.slice(0, 30).map((e, i) => <li key={i} className={`ev-${e.kind}`}><span aria-hidden="true">{e.kind === 'copy' ? '🔁' : '❗'}</span><span className="muted small nowrap">{new Date(e.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><strong>{e.label}</strong><span>{e.text}</span></li>)}
          </ul>
        </section>
      )}
    </>
  )
}
