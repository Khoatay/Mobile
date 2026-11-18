import { useEffect, useState } from 'react'
import { ADMIN_EXTRA, api, type AdminAi, type MyAi, type ProviderOpt } from '../lib/server'

const err = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

/** Ô chọn nhà cung cấp, dán khoá, lấy danh sách model. Dùng chung cho khách (khoá riêng) và chủ app (AI của Golden Duck). */
function ProviderForm({ providers, provider, model, savedKey, base, scope, onSave, saveLabel }: {
  providers: ProviderOpt[]; provider: string; model: string; savedKey: string; base?: string; scope: 'me' | 'system'
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
  if (!ai) return <section className="lite-card"><div className="lite-label">AI</div>{e ? <p className="notice bad">⚠ {e}</p> : <p className="muted">Đang tải…</p>}</section>
  const setMode = async (mode: 'system' | 'own') => {
    if (mode === 'own' && !ai.key) { setAi({ ...ai, mode }); return }
    try { setAi(await api<MyAi>('/ai/me', { mode })) } catch (x) { setE(err(x)) }
  }
  return (
    <section className="lite-card">
      <div className="lite-label">AI dùng để trả lời</div>
      <div className="srv-seg" role="radiogroup">
        <button role="radio" aria-checked={ai.mode === 'system'} className={ai.mode === 'system' ? 'active' : ''} onClick={() => setMode('system')}>AI của Golden Duck</button>
        <button role="radio" aria-checked={ai.mode === 'own'} className={ai.mode === 'own' ? 'active' : ''} onClick={() => setMode('own')}>Khoá AI của tôi</button>
      </div>
      {ai.mode === 'system' ? (
        <p className="muted small">{ai.system.ready ? `Đang dùng ${ai.system.label}, model ${ai.system.model}. Có giới hạn số tin mỗi ngày.` : 'AI của Golden Duck chưa bật. Bạn có thể dùng khoá AI của mình.'}</p>
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

/** Trang quản trị của chủ app: chọn AI mặc định cho mọi khách, dán khoá, nhập giá để tính chi phí, xem chi phí. */
export function AdminAiCard() {
  const [a, setA] = useState<AdminAi | null>(null)
  const [providers, setProviders] = useState<ProviderOpt[]>([])
  const [price, setPrice] = useState({ in: '', out: '' })
  const [e, setE] = useState('')
  useEffect(() => {
    api<AdminAi>('/admin/ai').then((x) => { setA(x); setPrice({ in: String(x.priceIn || ''), out: String(x.priceOut || '') }) }).catch((x) => setE(err(x)))
    api<MyAi>('/ai/me').then((x) => setProviders([...x.providers, ADMIN_EXTRA])).catch(() => {})
  }, [])
  if (!a || !providers.length) return <section className="lite-card srv-admin"><div className="lite-label">Quản trị · AI</div>{e ? <p className="notice bad">⚠ {e}</p> : <p className="muted">Đang tải…</p>}</section>
  const claude = a.provider === 'anthropic' && a.model.startsWith('claude-')
  return (
    <section className="lite-card srv-admin">
      <div className="lite-label">Quản trị · AI của Golden Duck <span className={`srv-badge ${a.ready ? 'pro' : ''}`}>{a.ready ? 'Đang bật' : 'Chưa bật'}</span></div>
      <p className="muted small">Khách chọn "AI của Golden Duck" sẽ dùng cấu hình này, tiền tính vào khoá của bạn. Đổi lúc nào cũng được.</p>
      <ProviderForm key={a.provider + a.model} providers={providers} provider={a.provider} model={a.model} savedKey={a.keys[a.provider] ?? ''} base={a.base} scope="system" saveLabel="Lưu cho mọi khách"
        onSave={async (v) => setA(await api<AdminAi>('/admin/ai', { provider: v.provider, model: v.model, key: v.key, base: v.base }))} />
      {!claude && (
        <div className="srv-price">
          <div className="lite-label">Giá model (USD / 1 triệu token) để tính chi phí</div>
          <label>Vào<input inputMode="decimal" value={price.in} onChange={(x) => setPrice({ ...price, in: x.target.value })} /></label>
          <label>Ra<input inputMode="decimal" value={price.out} onChange={(x) => setPrice({ ...price, out: x.target.value })} /></label>
          <button onClick={async () => { try { setA(await api<AdminAi>('/admin/ai', { priceIn: Number(price.in) || 0, priceOut: Number(price.out) || 0 })) } catch (x) { setE(err(x)) } }}>Lưu giá</button>
        </div>
      )}
      <div className="srv-usage">
        <div><span>Hôm nay</span><strong>{a.today.calls} tin</strong><small>{usd(a.today.cost)}</small></div>
        <div><span>Tháng này</span><strong>{a.month.calls} tin</strong><small>{usd(a.month.cost)}</small></div>
        <div><span>Khách dùng khoá riêng</span><strong>{a.today.own} tin</strong><small>hôm nay</small></div>
      </div>
      {e && <p className="notice bad">⚠ {e}</p>}
    </section>
  )
}
