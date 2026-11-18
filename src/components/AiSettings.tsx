import { useEffect, useMemo, useState } from 'react'
import { bridgeGet, bridgePost } from '../lib/bridge'

interface Choice { id: string; name: string; in: number; out: number }
export interface AiStatus { configured: boolean; model: string; key_hint: string; models: Record<string, string>; choices: Choice[]; features: Record<string, string> }
interface UsageRow { calls: number; input: number; output: number; cache_read: number; cache_write: number; cost: number }
interface Usage { days: Record<string, Record<string, UsageRow>>; features: Record<string, string> }

const VND = 26_000 // tỷ giá ước tính để quy ra đồng
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')
const usd = (v: number) => (v >= 1 ? `${v.toFixed(2)} USD` : `${v.toFixed(3)} USD`)
const vnd = (v: number) => `≈ ${Math.round((v * VND) / 100) * 100 >= 1000 ? (Math.round((v * VND) / 1000)).toLocaleString('vi-VN') + ' nghìn đ' : Math.round(v * VND).toLocaleString('vi-VN') + 'đ'}`

/** Chi phí ước tính một tin chat trung bình theo model (đã tính lưu tạm lịch sử), để chọn model dễ hơn. */
const CHAT_HINT: Record<string, string> = { 'claude-haiku-5-5': '≈ 10–25đ/tin', 'claude-sonnet-5-5': '≈ 300–500đ/tin', 'claude-opus-5-5': '≈ 600–1.000đ/tin' }

/**
 * Cài AI cho bản IB: nhập khoá API của chính bạn (lưu trên máy chạy bridge), chọn model cho từng tính năng, xem chi phí.
 * `compact`: chỉ phần nhập khoá (dùng ở các trang AI khi chưa có khoá).
 */
export default function AiSettings({ compact = false }: { compact?: boolean }) {
  const [st, setSt] = useState<AiStatus | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = () => {
    bridgeGet<AiStatus>('/ai/status').then(setSt).catch(() => {})
    if (!compact) bridgeGet<Usage>('/ai/usage').then(setUsage).catch(() => {})
  }
  useEffect(load, [])

  const saveKey = async () => {
    setBusy(true); setMsg(null)
    try {
      setSt(await bridgePost<AiStatus>('/ai/key', { key })); setKey('')
      setMsg({ ok: true, text: compact ? 'Khoá hợp lệ, đã lưu. Đang mở lại trang…' : 'Khoá hợp lệ, đã lưu. Các tính năng AI dùng được ngay.' })
      // Ở các trang AI, trang đang chờ khoá: tải lại để dùng được ngay.
      if (compact) setTimeout(() => window.location.reload(), 900)
    }
    catch (e) { setMsg({ ok: false, text: errText(e) }) } finally { setBusy(false) }
  }
  const setModel = async (feature: string, model: string) => {
    try { setSt(await bridgePost<AiStatus>('/ai/models', { models: { [feature]: model } })) } catch (e) { setMsg({ ok: false, text: errText(e) }) }
  }

  // Tổng theo khoảng: hôm nay, 7 ngày, 30 ngày; và theo tính năng trong 30 ngày.
  const sums = useMemo(() => {
    if (!usage) return null
    const today = new Date().toISOString().slice(0, 10)
    const since = (n: number) => new Date(Date.now() - (n - 1) * 86_400_000).toISOString().slice(0, 10)
    const total = (from: string) => Object.entries(usage.days).filter(([d]) => d >= from).reduce((s, [, f]) => s + Object.values(f).reduce((a, r) => a + r.cost, 0), 0)
    const byFeature: Record<string, { calls: number; cost: number }> = {}
    for (const [d, f] of Object.entries(usage.days)) if (d >= since(30)) for (const [k, r] of Object.entries(f)) { byFeature[k] ??= { calls: 0, cost: 0 }; byFeature[k].calls += r.calls; byFeature[k].cost += r.cost }
    return { today: total(today), week: total(since(7)), month: total(since(30)), byFeature }
  }, [usage])

  const keyForm = (
    <>
      {st?.configured ? (
        <p className="tg-ok">✅ Đã có khoá API {st.key_hint && <code>{st.key_hint}</code>}. Muốn đổi khoá thì dán khoá mới bên dưới.</p>
      ) : (
        <ol className="tg-steps">
          <li>Vào <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>, đăng ký bằng email.</li>
          <li>Mục <b>Billing</b>: nạp tiền (thẻ Visa/Mastercard), ví dụ 5–10 USD để bắt đầu. Ở mục <b>Limits</b> đặt giới hạn chi mỗi tháng để không bao giờ tốn quá tay.</li>
          <li>Mục <b>API Keys</b> → <b>Create Key</b> → chép khoá bắt đầu bằng <code>sk-ant-</code>.</li>
          <li>Dán vào ô dưới và bấm Lưu. App thử khoá trước khi lưu.</li>
        </ol>
      )}
      <div className="actions">
        <input className="tg-token" type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value.trim())} />
        <button className="primary" disabled={busy || !key} onClick={saveKey}>{busy ? 'Đang thử khoá…' : 'Lưu khoá'}</button>
      </div>
      <p className="muted small">Khoá chỉ lưu trong <code>bridge/config.json</code> trên máy chạy bridge, không gửi lên trình duyệt hay máy chủ nào khác. Không đưa khoá cho người khác: ai có khoá là dùng bằng tiền của bạn.</p>
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
    </>
  )

  if (compact) return <section className="card"><h3>Cài khoá AI (khoá API của Anthropic)</h3>{keyForm}</section>

  return (
    <section className="card ai-settings">
      <h3>AI của bạn</h3>
      <p className="muted small">Các tính năng AI (Golden Duck Talk, AI học trade, AI phân tích, đánh giá tài khoản) chạy bằng khoá API của chính bạn, tính tiền theo lượng chữ gửi đi và nhận về.</p>
      {!st ? <p className="muted">Cần chạy bridge để cài AI.</p> : (
        <>
          {keyForm}
          <h4 className="form-sub">Model cho từng tính năng</h4>
          <div className="ai-models">
            {Object.entries(st.features).map(([f, label]) => (
              <label key={f} className="field">
                <span className="field-label">{label}</span>
                <select value={st.models[f]} onChange={(e) => setModel(f, e.target.value)}>
                  {st.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span className="field-hint">{f === 'chat' ? `${CHAT_HINT[st.models[f]] ?? ''}. Chat nên dùng Haiku: đủ tốt, rẻ hơn Opus khoảng 40 lần.` : f === 'rate' ? 'Mỗi lần chấm ≈ 1–4 nghìn đ với Opus. Kết quả được lưu, chỉ chấm lại khi có lệnh mới.' : 'Cần suy luận kỹ: nên dùng Opus hoặc Sonnet.'}</span>
              </label>
            ))}
          </div>
          <h4 className="form-sub">Chi phí (ước tính)</h4>
          {sums && (sums.month > 0 ? (
            <>
              <div className="tiles wide">
                <div className="tile"><div className="tile-label">Hôm nay</div><div className="tile-value">{usd(sums.today)}</div><div className="tile-sub">{vnd(sums.today)}</div></div>
                <div className="tile"><div className="tile-label">7 ngày</div><div className="tile-value">{usd(sums.week)}</div><div className="tile-sub">{vnd(sums.week)}</div></div>
                <div className="tile"><div className="tile-label">30 ngày</div><div className="tile-value">{usd(sums.month)}</div><div className="tile-sub">{vnd(sums.month)}</div></div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Tính năng (30 ngày)</th><th className="num">Số lần gọi</th><th className="num">Chi phí</th><th className="num">Trung bình mỗi lần</th></tr></thead>
                  <tbody>{Object.entries(sums.byFeature).sort((a, b) => b[1].cost - a[1].cost).map(([f, r]) => <tr key={f}><td>{usage!.features[f] ?? f}</td><td className="num">{r.calls}</td><td className="num">{usd(r.cost)} <span className="muted small">{vnd(r.cost)}</span></td><td className="num">{vnd(r.cost / Math.max(1, r.calls))}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          ) : <p className="muted small">Chưa có lần gọi AI nào.</p>)}
          <p className="muted small">Tính theo bảng giá của Anthropic (11/2026) và tỷ giá khoảng {VND.toLocaleString('vi-VN')}đ/USD. Số chính xác xem ở console.anthropic.com → Usage.</p>
        </>
      )}
    </section>
  )
}
