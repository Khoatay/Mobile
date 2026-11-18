import { useEffect, useState } from 'react'
import { ask } from '../lib/ask'
import { DEFAULT_BASKET, type AutomationSnapshot, type BasketConfig } from '../lib/automation'
import { bridgeGet, bridgePost, type LiveAccount, type PendingOrder } from '../lib/bridge'
import { normalizeSymbol } from '../lib/forex'
import { money, signed } from '../lib/format'
import { fmtServerTime } from '../lib/parse'
import { LimitInput } from '../pages/Guard'

const TYPE_NAME: Record<string, string> = { buy_limit: 'Buy Limit', sell_limit: 'Sell Limit', buy_stop: 'Buy Stop', sell_stop: 'Sell Stop', buy_stop_limit: 'Buy Stop Limit', sell_stop_limit: 'Sell Stop Limit' }
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

/** Lệnh chờ (limit/stop) của một hoặc nhiều tài khoản, có nút huỷ từng lệnh và huỷ tất cả. */
export function PendingTable({ rows, showAccount, labelOf, busy, onCancel, onCancelAll }: {
  rows: (PendingOrder & { acc: LiveAccount })[]; showAccount: boolean; labelOf: (a: LiveAccount) => string; busy: boolean
  onCancel: (acc: LiveAccount, o: PendingOrder) => void; onCancelAll: () => void
}) {
  if (!rows.length) return null
  return (
    <section className="card">
      <div className="card-head">
        <h3>{rows.length} lệnh chờ</h3>
        {rows.some((o) => o.acc.tradable) && <button className="ghost danger" disabled={busy} onClick={onCancelAll}>Huỷ tất cả lệnh chờ</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>{showAccount && <th>Tài khoản</th>}<th>Đặt lúc</th><th>Cặp</th><th>Loại</th><th className="num">Lot</th><th className="num">Giá chờ</th><th className="num">SL</th><th className="num">TP</th><th /></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.acc.id + ':' + o.ticket}>
                {showAccount && <td>{labelOf(o.acc)}</td>}
                <td className="nowrap">{fmtServerTime(o.time * 1000).slice(0, 16)}</td>
                <td>{normalizeSymbol(o.symbol)}</td>
                <td>{TYPE_NAME[o.type] ?? o.type}</td>
                <td className="num">{o.volume.toFixed(2)}</td>
                <td className="num">{o.price}{o.stopLimit ? ` → ${o.stopLimit}` : ''}</td>
                <td className="num">{o.sl || '–'}</td>
                <td className="num">{o.tp || '–'}</td>
                <td>{o.acc.tradable && <button disabled={busy} onClick={() => onCancel(o.acc, o)}>Huỷ</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((o) => !o.sl) && <p className="warn">⚠ Có lệnh chờ không đặt stop loss: khớp lệnh là chạy không có SL.</p>}
    </section>
  )
}

/** Đóng tất cả lệnh của tài khoản khi tổng lãi hoặc tổng lỗ đang treo chạm mức (theo % số dư hoặc số tiền). Bridge canh 2 giây một lần, kể cả khi app đóng. */
export function BasketPanel({ acc, online }: { acc: LiveAccount; online: boolean }) {
  const [snap, setSnap] = useState<AutomationSnapshot | null>(null)
  const [cfg, setCfg] = useState<BasketConfig | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (!online) return
    const load = () => bridgeGet<AutomationSnapshot>('/automation').then((s) => { setSnap(s); setCfg((c) => c ?? { ...DEFAULT_BASKET, ...s.baskets?.[acc.id] }) }).catch(() => {})
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [online, acc.id])
  if (!cfg) return null
  const saved = snap?.baskets?.[acc.id]
  const st = snap?.basketStates?.[acc.id]
  const on = !!saved?.enabled
  const set = (p: Partial<BasketConfig>) => setCfg({ ...cfg, ...p })
  const floating = acc.equity - acc.balance
  const save = async (enabled: boolean) => {
    if (enabled && !(await ask(`Bật tự đóng tất cả cho tài khoản này? Khi tổng lãi/lỗ đang treo chạm mức, bridge đóng hết lệnh đang mở${cfg.cancel_pending ? ' và huỷ hết lệnh chờ' : ''} theo giá thị trường. Lệnh khớp ở giá thực tế, có thể trượt so với mức đặt khi giá chạy nhanh.`, 'Bật', true))) return
    try { const s = await bridgePost<AutomationSnapshot>('/automation/basket', { account: acc.id, config: { ...cfg, enabled } }); setSnap(s); setMsg({ ok: true, text: enabled ? 'Đã bật. Bridge canh 2 giây một lần, kể cả khi bạn tắt app.' : 'Đã tắt tự đóng tất cả.' }) }
    catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }
  return (
    <section className={on ? 'card basket on' : 'card basket'}>
      <div className="card-head">
        <h3>Tự đóng tất cả lệnh khi tổng lãi/lỗ chạm mức</h3>
        <span className={floating > 0 ? 'float-sum pos' : floating < 0 ? 'float-sum neg' : 'float-sum'}>Đang treo {signed(floating)} {acc.currency}</span>
      </div>
      {on && st && !st.error && (
        <p className="muted small">
          Đang canh: đóng khi lãi đạt {st.tp ? <strong className="pos">+{money(st.tp, acc.currency)}</strong> : '–'} hoặc lỗ tới {st.sl ? <strong className="neg">−{money(st.sl, acc.currency)}</strong> : '–'}.
        </p>
      )}
      {st?.error && <p className="notice bad">⚠ {st.error}</p>}
      <div className="prop-form">
        <LimitInput label="Đóng tất cả khi tổng lãi đạt" tone="tp" mode={cfg.tp_mode} value={cfg.tp_value} balance={acc.balance} ccy={acc.currency} hint="0 = không áp dụng" onChange={(p) => set({ ...(p.mode ? { tp_mode: p.mode } : {}), ...(p.value != null ? { tp_value: p.value } : {}) })} />
        <LimitInput label="Đóng tất cả khi tổng lỗ tới" tone="sl" mode={cfg.sl_mode} value={cfg.sl_value} balance={acc.balance} ccy={acc.currency} hint="0 = không áp dụng" onChange={(p) => set({ ...(p.mode ? { sl_mode: p.mode } : {}), ...(p.value != null ? { sl_value: p.value } : {}) })} />
      </div>
      <label className="inline wrap"><input type="checkbox" className="check" checked={cfg.cancel_pending} onChange={(e) => set({ cancel_pending: e.target.checked })} /> Huỷ luôn các lệnh chờ khi đóng tất cả</label>
      {!acc.tradable && <p className="muted small">Tài khoản dùng mật khẩu view: app chỉ báo khi chạm mức, bạn tự đóng lệnh.</p>}
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="primary" onClick={() => save(true)}>{on ? 'Lưu' : 'Bật tự đóng tất cả'}</button>
        {on && <button className="ghost" onClick={() => save(false)}>Tắt</button>}
      </div>
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
      <p className="muted small">Tính trên tổng lãi/lỗ đang treo của mọi lệnh đang mở trong tài khoản (gồm swap). Mức theo % tính trên số dư hiện tại.</p>
    </section>
  )
}
