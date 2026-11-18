import { useEffect, useState } from 'react'
import { ADMIN_EXTRA, api, type AdminAi, type MyAi, type ProviderOpt, type SlotCfg } from '../lib/server'

const err = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

/** Ô chọn nhà cung cấp, dán khoá, lấy danh sách model. Dùng chung cho khách (khoá riêng) và chủ app (AI của Golden Duck). */
function ProviderForm({ providers, provider, model, savedKey, base, scope, onSave, saveLabel }: {
  providers: ProviderOpt[]; provider: string; model: string; savedKey: string; base?: string; scope: 'me' | 'cheap' | 'strong'
  onSave: (v: { provider: string; model: string; key: string; base: string }) => Promise<void>; saveLabel: string
}) {
  const [p, setP] = useState(provider)
  const [m, setM] = useState(model)
  const [key, setKey] = useState('')
  const [b, setB] = useState(base ?? '')
  const [list, setList] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const info = providers.find((x) => x.id === p)
  const sameProvider = p === provider
  useEffect(() => { setList([]); if (!sameProvider) setM('') }, [p])

  async function load() {
    setBusy('models'); setMsg(null)
    try { const r = await api<{ models: string[] }>('/ai/models', { provider: p, key, base: b, scope }); setList(r.models); if (!r.models.includes(m)) setM(r.models[0] ?? '') ; setMsg({ ok: true, text: `Khoá dùng được, có ${r.models.length} model.` }) }
    catch (e) { setMsg({ ok: false, text: err(e) }) }
    finally { setBusy('') }
  }
  async function save() {
    setBusy('save'); setMsg(null)
    try { await onSave({ provider: p, model: m, key, base: b }); setKey(''); setMsg({ ok: true, text: 'Đã lưu.' }) }
    catch (e) { setMsg({ ok: false, text: err(e) }) }
    finally { setBusy('') }
  }
  async function test() {
    setBusy('test'); setMsg(null)
    try { const r = await api<{ reply: string; model: string }>('/ai/test', { scope }); setMsg({ ok: true, text: `AI trả lời "${r.reply}" (model ${r.model}).` }) }
    catch (e) { setMsg({ ok: false, text: err(e) }) }
    finally { setBusy('') }
  }

  return (
    <div className="srv-ai-form">
      <label>Nhà cung cấp
        <select value={p} onChange={(e) => setP(e.target.value)}>{providers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
      </label>
      {p === 'custom' && <label>Địa chỉ API<input value={b} onChange={(e) => setB(e.target.value)} placeholder="https://…/v1" autoCapitalize="off" /></label>}
      <label>Khoá API {sameProvider && savedKey && <small className="muted">· đang lưu khoá {savedKey}</small>}
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={sameProvider && savedKey ? 'Để trống nếu giữ khoá cũ' : 'Dán khoá vào đây'} autoComplete="off" />
        <small className="muted">{info?.keyUrl && <>Lấy khoá ở <strong>{info.keyUrl}</strong>. </>}{info?.hint}</small>
      </label>
      <label>Model
        <div className="srv-model-row">
          {list.length ? (
            <select value={m} onChange={(e) => setM(e.target.value)}>{list.map((x) => <option key={x}>{x}</option>)}</select>
          ) : (
            <input value={m} onChange={(e) => setM(e.target.value)} placeholder="Bấm Lấy danh sách, hoặc gõ tên model" autoCapitalize="off" />
          )}
          <button type="button" onClick={load} disabled={!!busy || (!key && !(sameProvider && savedKey))}>{busy === 'models' ? 'Đang lấy…' : 'Lấy danh sách'}</button>
        </div>
      </label>
      <div className="srv-ai-actions">
        <button className="primary" onClick={save} disabled={!!busy || !m}>{busy === 'save' ? 'Đang lưu…' : saveLabel}</button>
        {sameProvider && savedKey && !key && <button onClick={test} disabled={!!busy}>{busy === 'test' ? 'Đang thử…' : 'Thử AI'}</button>}
      </div>
      {msg && <p className={`notice ${msg.ok ? 'good' : 'bad'}`}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
    </div>
  )
}

/** Mục AI trong Tài khoản: dùng AI của Golden Duck (có giới hạn) hoặc khoá riêng (không giới hạn, tự trả tiền). */
export function MyAiCard() {
  const [ai, setAi] = useState<MyAi | null>(null)
  const [e, setE] = useState('')
  useEffect(() => { api<MyAi>('/ai/me').then(setAi).catch((x) => setE(err(x))) }, [])
  if (!ai) return <section className="lite-card srv-adv-body"><div className="lite-label">AI</div>{e ? <p className="notice bad">⚠ {e}</p> : <p className="muted">Đang tải…</p>}</section>
  const setMode = async (mode: 'system' | 'own') => {
    if (mode === 'own' && !ai.key) { setAi({ ...ai, mode }); return }
    try { setAi(await api<MyAi>('/ai/me', { mode })) } catch (x) { setE(err(x)) }
  }
  return (
    <section className="srv-adv-body">
      <div className="lite-label">AI dùng để trả lời</div>
      <div className="srv-seg" role="radiogroup">
        <button role="radio" aria-checked={ai.mode === 'system'} className={ai.mode === 'system' ? 'active' : ''} onClick={() => setMode('system')}>AI của Golden Duck</button>
        <button role="radio" aria-checked={ai.mode === 'own'} className={ai.mode === 'own' ? 'active' : ''} onClick={() => setMode('own')}>Khoá AI của tôi</button>
      </div>
      {ai.mode === 'system' ? (
        <p className="muted small">{ai.system.ready ? 'Mặc định, không cần cài gì. Có giới hạn số tin mỗi ngày.' : 'AI của Golden Duck chưa bật. Bạn có thể dùng khoá AI của mình.'}</p>
      ) : (
        <>
          <p className="muted small">Dùng tài khoản AI của bạn: chọn hãng và model tuỳ thích, không giới hạn số tin, tiền AI tính vào tài khoản của bạn. Khoá được mã hoá khi lưu và không hiện lại.</p>
          <ProviderForm providers={ai.providers} provider={ai.provider} model={ai.model} savedKey={ai.key} scope="me" saveLabel="Lưu và dùng"
            onSave={async (v) => setAi(await api<MyAi>('/ai/me', { mode: 'own', provider: v.provider, model: v.model, key: v.key }))} />
        </>
      )}
      {e && <p className="notice bad">⚠ {e}</p>}
    </section>
  )
}

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`

const SLOTS: ['cheap' | 'strong', string, string][] = [
  ['cheap', 'Model rẻ', 'Dùng cho chat và giải thích, chiếm phần lớn lượt dùng. Chọn loại nhanh, rẻ.'],
  ['strong', 'Model mạnh', 'Dùng cho phân tích sâu, và cho khách Pro chat nếu bật bên dưới. Chọn loại thông minh.'],
]

function SlotCard({ slot, title, note, a, providers, setA }: { slot: 'cheap' | 'strong'; title: string; note: string; a: AdminAi; providers: ProviderOpt[]; setA: (a: AdminAi) => void }) {
  const c: SlotCfg = a[slot]
  const [price, setPrice] = useState({ in: String(c.priceIn || ''), out: String(c.priceOut || '') })
  const [e, setE] = useState('')
  const claude = c.provider === 'anthropic' && c.model.startsWith('claude-')
  return (
    <section className="lite-card srv-admin">
      <div className="lite-label">{title} <span className={`srv-badge ${a.ready[slot] ? 'pro' : ''}`}>{a.ready[slot] ? 'Đang bật' : 'Chưa bật'}</span></div>
      <p className="muted small">{note}</p>
      <ProviderForm key={c.provider + c.model} providers={providers} provider={c.provider} model={c.model} savedKey={a.keys[c.provider] ?? ''} base={c.base} scope={slot} saveLabel="Lưu"
        onSave={async (v) => setA(await api<AdminAi>('/admin/ai', { slot, provider: v.provider, model: v.model, key: v.key, base: v.base }))} />
      {!claude && c.model && (
        <div className="srv-price">
          <div className="lite-label">Giá model này (USD / 1 triệu token), để app tính chi phí</div>
          <label>Vào<input inputMode="decimal" value={price.in} onChange={(x) => setPrice({ ...price, in: x.target.value })} /></label>
          <label>Ra<input inputMode="decimal" value={price.out} onChange={(x) => setPrice({ ...price, out: x.target.value })} /></label>
          <button onClick={async () => { try { setA(await api<AdminAi>('/admin/ai', { slot, priceIn: Number(price.in) || 0, priceOut: Number(price.out) || 0 })) } catch (x) { setE(err(x)) } }}>Lưu giá</button>
        </div>
      )}
      {e && <p className="notice bad">⚠ {e}</p>}
    </section>
  )
}

/** Trang Quản trị của chủ app: 2 ô model cho mọi khách, chi phí, nâng khách lên Pro. */
export function AdminPage() {
  const [a, setA] = useState<AdminAi | null>(null)
  const [providers, setProviders] = useState<ProviderOpt[]>([])
  const [e, setE] = useState('')
  const [plan, setPlan] = useState({ email: '', days: '30' })
  const [planMsg, setPlanMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    api<AdminAi>('/admin/ai').then(setA).catch((x) => setE(err(x)))
    api<MyAi>('/ai/me').then((x) => setProviders([...x.providers, ADMIN_EXTRA])).catch(() => {})
  }, [])
  async function upgrade(ev: React.FormEvent) {
    ev.preventDefault(); setPlanMsg(null)
    try {
      const r = await api<{ email: string; plan: string; until: number | null }>('/admin/plan', { email: plan.email, days: Number(plan.days) || 0 })
      setPlanMsg({ ok: true, text: r.plan === 'pro' ? `${r.email} đã lên Pro đến ${new Date(r.until!).toLocaleDateString('vi-VN')}.` : `${r.email} đã về gói Miễn phí.` })
    } catch (x) { setPlanMsg({ ok: false, text: err(x) }) }
  }
  if (!a || !providers.length) return <><h1>Quản trị</h1>{e ? <p className="notice bad">⚠ {e}</p> : <p className="muted">Đang tải…</p>}</>
  return (
    <>
      <h1>Quản trị</h1>
      <p className="muted">Chỉ bạn thấy trang này. Khách dùng AI của Golden Duck theo 2 ô dưới đây, tiền tính vào khoá của bạn.</p>
      <section className="lite-card">
        <div className="lite-label">Chi phí AI</div>
        <div className="srv-usage">
          <div><span>Hôm nay</span><strong>{a.today.calls} tin</strong><small>{usd(a.today.cost)}</small></div>
          <div><span>Tháng này</span><strong>{a.month.calls} tin</strong><small>{usd(a.month.cost)}</small></div>
          <div><span>Trả lời soạn sẵn</span><strong>{a.today.canned} tin</strong><small>hôm nay, $0</small></div>
        </div>
        <p className="muted small">Khách Pro dùng khoá riêng hôm nay: {a.today.own} tin (không tính vào tiền của bạn).</p>
      </section>
      {SLOTS.map(([slot, title, note]) => <SlotCard key={slot} slot={slot} title={title} note={note} a={a} providers={providers} setA={setA} />)}
      <section className="lite-card">
        <label className="srv-toggle"><input type="checkbox" checked={a.proStrong} onChange={async (x) => { try { setA(await api<AdminAi>('/admin/ai', { proStrong: x.target.checked })) } catch (y) { setE(err(y)) } }} />
          <span><strong>Khách Pro chat bằng model mạnh</strong><small className="muted">Tắt thì mọi khách chat bằng model rẻ.</small></span></label>
      </section>
      <form className="lite-card srv-form" onSubmit={upgrade}>
        <div className="lite-label">Nâng khách lên Pro (tạm thời, trước khi có thanh toán)</div>
        <label>Email khách<input type="email" required value={plan.email} onChange={(x) => setPlan({ ...plan, email: x.target.value })} /></label>
        <label>Số ngày (0 = về Miễn phí)<input inputMode="numeric" value={plan.days} onChange={(x) => setPlan({ ...plan, days: x.target.value })} /></label>
        <button className="primary">Cập nhật gói</button>
        {planMsg && <p className={`notice ${planMsg.ok ? 'good' : 'bad'}`}>{planMsg.ok ? '✓' : '⚠'} {planMsg.text}</p>}
      </form>
      {e && <p className="notice bad">⚠ {e}</p>}
    </>
  )
}
