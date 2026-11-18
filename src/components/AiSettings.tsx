import { useEffect, useMemo, useState } from 'react'
import { bridgeGet, bridgePost } from '../lib/bridge'

interface Provider { id: string; label: string; key_url: string; hint: string }
interface SlotCfg { provider: string; model: string; base: string }
type Slot = 'cheap' | 'strong'
export interface AiStatus {
  configured: boolean; ready: Record<Slot, boolean>; slots: Record<Slot, SlotCfg>; keys: Record<string, string>
  providers: Provider[]; features: Record<string, string>; slot_of: Record<string, Slot>; slot_labels: Record<Slot, string>
}
interface UsageRow { calls: number; input: number; output: number; cache_read: number; cache_write: number; cost: number }
interface Usage { days: Record<string, Record<string, UsageRow>>; features: Record<string, string> }

const VND = 26_000 // tỷ giá ước tính để quy ra đồng
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')
const usd = (v: number) => (v >= 1 ? `${v.toFixed(2)} USD` : `${v.toFixed(3)} USD`)
const vnd = (v: number) => `≈ ${Math.round((v * VND) / 100) * 100 >= 1000 ? (Math.round((v * VND) / 1000)).toLocaleString('vi-VN') + ' nghìn đ' : Math.round(v * VND).toLocaleString('vi-VN') + 'đ'}`

/** Chi phí ước tính một tin chat trung bình theo model (đã tính lưu tạm lịch sử), để chọn model dễ hơn. */
const CHAT_HINT: Record<string, string> = { 'claude-haiku-5-5': '≈ 10–25đ/tin', 'claude-sonnet-5-5': '≈ 300–500đ/tin', 'claude-opus-5-5': '≈ 600–1.000đ/tin' }
const SLOT_NOTE: Record<Slot, string> = {
  cheap: 'Dùng cho chat, chiếm phần lớn lượt dùng. Chọn loại nhanh, rẻ.',
  strong: 'Dùng cho học trade, phân tích, đánh giá tài khoản: cần suy luận kỹ. Đọc tài liệu PDF cần Claude hoặc Gemini.',
}

/** Một ô model: chọn hãng, dán khoá (nếu hãng đó chưa có khoá), lấy danh sách model, lưu. */
function SlotEditor({ slot, st, setSt, title, note, both }: { slot: Slot; st: AiStatus; setSt: (s: AiStatus) => void; title: string; note: string; both?: boolean }) {
  const cur = st.slots[slot]
  const [p, setP] = useState(cur.provider)
  const [m, setM] = useState(cur.model)
  const [base, setBase] = useState(cur.base)
  const [key, setKey] = useState('')
  const [list, setList] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const info = st.providers.find((x) => x.id === p)
  const saved = st.keys[p]
  useEffect(() => { setList([]); if (p !== cur.provider) setM('') }, [p])

  async function load() {
    setBusy('list'); setMsg(null)
    try { const r = await bridgePost<{ models: string[] }>('/ai/list-models', { provider: p, key, base }); setList(r.models); if (!r.models.includes(m)) setM(r.models[0] ?? ''); setMsg({ ok: true, text: `Khoá dùng được, có ${r.models.length} model.` }) }
    catch (e) { setMsg({ ok: false, text: errText(e) }) } finally { setBusy('') }
  }
  async function save() {
    setBusy('save'); setMsg(null)
    try {
      let s = st
      if (key) s = await bridgePost<AiStatus>('/ai/key', { provider: p, key, base })
      for (const sl of both ? (['cheap', 'strong'] as Slot[]) : [slot]) s = await bridgePost<AiStatus>('/ai/models', { slot: sl, provider: p, model: m, base })
      setSt(s); setKey(''); setMsg({ ok: true, text: both ? 'Đã lưu. Các tính năng AI dùng được ngay.' : 'Đã lưu.' })
      if (both) setTimeout(() => window.location.reload(), 900)
    } catch (e) { setMsg({ ok: false, text: errText(e) }) } finally { setBusy('') }
  }

  return (
    <div className="ai-slot">
      <h4 className="form-sub">{title} {st.ready[slot] && !both && <span className="muted small">· đang dùng {st.providers.find((x) => x.id === cur.provider)?.label} · {cur.model}</span>}</h4>
      <p className="muted small">{note}</p>
      <div className="ai-slot-grid">
        <label className="field"><span className="field-label">Nhà cung cấp</span>
          <select value={p} onChange={(e) => setP(e.target.value)}>{st.providers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        </label>
        {p === 'custom' && <label className="field"><span className="field-label">Địa chỉ API</span><input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://…/v1" /></label>}
        <label className="field"><span className="field-label">Khoá API {saved && <span className="muted">· đã có {saved}</span>}</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder={saved ? 'Để trống nếu giữ khoá cũ' : 'Dán khoá vào đây'} />
          <span className="field-hint">{info?.key_url && <>Lấy khoá ở <b>{info.key_url}</b>. </>}{info?.hint}</span>
        </label>
        <label className="field"><span className="field-label">Model</span>
          <div className="actions">
            {list.length ? <select value={m} onChange={(e) => setM(e.target.value)}>{list.map((x) => <option key={x}>{x}</option>)}</select>
              : <input value={m} onChange={(e) => setM(e.target.value)} placeholder="Bấm Lấy danh sách, hoặc gõ tên model" />}
            <button disabled={!!busy || (!key && !saved)} onClick={load}>{busy === 'list' ? 'Đang lấy…' : 'Lấy danh sách'}</button>
          </div>
          {slot === 'cheap' && CHAT_HINT[m] && <span className="field-hint">{CHAT_HINT[m]}</span>}
        </label>
      </div>
      <div className="actions">
        <button className="primary" disabled={!!busy || !m || (!key && !saved)} onClick={save}>{busy === 'save' ? 'Đang lưu…' : 'Lưu'}</button>
      </div>
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
    </div>
  )
}

/**
 * Cài AI cho bản IB: chọn hãng, nhập khoá API của chính bạn (lưu trên máy chạy bridge), chọn model rẻ và model mạnh, xem chi phí.
 * `compact`: chỉ phần nhập khoá (dùng ở các trang AI khi chưa có khoá).
 */
export default function AiSettings({ compact = false }: { compact?: boolean }) {
  const [st, setSt] = useState<AiStatus | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  useEffect(() => {
    bridgeGet<AiStatus>('/ai/status').then(setSt).catch(() => {})
    if (!compact) bridgeGet<Usage>('/ai/usage').then(setUsage).catch(() => {})
  }, [])
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

  if (compact) return (
    <section className="card">
      <h3>Cài AI</h3>
      <p className="muted small">Chọn hãng AI, dán khoá API của bạn, chọn một model là dùng được. Sau này vào Cá nhân hoá để chọn model rẻ cho chat và model mạnh cho phân tích.</p>
      {st ? <SlotEditor slot="cheap" st={st} setSt={setSt} title="AI của bạn" note="" both /> : <p className="muted">Cần chạy bridge để cài AI.</p>}
      <p className="muted small">Khoá chỉ lưu trong <code>bridge/config.json</code> trên máy chạy bridge. Không đưa khoá cho người khác: ai có khoá là dùng bằng tiền của bạn.</p>
    </section>
  )

  return (
    <section className="card ai-settings">
      <h3>AI của bạn</h3>
      <p className="muted small">Các tính năng AI chạy bằng khoá API của chính bạn: Claude, ChatGPT, Gemini, DeepSeek, Grok, OpenRouter, Qwen hoặc Groq. Tiền tính theo lượng chữ gửi đi và nhận về.</p>
      {!st ? <p className="muted">Cần chạy bridge để cài AI.</p> : (
        <>
          {(['cheap', 'strong'] as Slot[]).map((sl) => <SlotEditor key={sl + st.slots[sl].provider + st.slots[sl].model} slot={sl} st={st} setSt={setSt} title={sl === 'cheap' ? 'Model rẻ' : 'Model mạnh'} note={SLOT_NOTE[sl]} />)}
          <p className="muted small">Khoá chỉ lưu trong <code>bridge/config.json</code> trên máy chạy bridge, không gửi đi đâu khác. Mỗi hãng một khoá, dùng chung cho cả hai ô.</p>
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
          <p className="muted small">Chi phí tính theo bảng giá Claude (11/2026) và tỷ giá khoảng {VND.toLocaleString('vi-VN')}đ/USD. Model của hãng khác chỉ đếm lượt, xem tiền ở trang của hãng đó.</p>
        </>
      )}
    </section>
  )
}
