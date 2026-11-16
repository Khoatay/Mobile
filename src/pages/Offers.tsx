import { useMemo, useState } from 'react'
import { Field } from '../components/Field'
import { ask } from '../lib/ask'
import { bridgePost, type BridgeState } from '../lib/bridge'
import { blankOffer, daysLeft, OFFER_KIND_TEXT, offerCaption, offerName, offerUrl, sortOffers, type Offer, type OfferKind } from '../lib/offers'
import { isWebUrl, PARTNERS, type PartnerLinks } from '../lib/partners'
import { usePersistent } from '../lib/store'

const FILTERS: (OfferKind | '')[] = ['', 'broker', 'prop', 'tool', 'other']

function Editor({ value, onSave, onCancel }: { value: Offer; onSave: (o: Offer) => void; onCancel: () => void }) {
  const [o, setO] = useState(value)
  const set = (p: Partial<Offer>) => setO({ ...o, ...p })
  const badUrl = !!o.url && !isWebUrl(o.url)
  return (
    <section className="card">
      <h3>{value.title ? 'Sửa ưu đãi' : 'Thêm ưu đãi'}</h3>
      <div className="prop-form">
        <Field label="Đối tác">
          <select value={o.partner || '__other'} onChange={(e) => {
            const p = PARTNERS.find((x) => x.id === e.target.value)
            set(p ? { partner: p.id, kind: p.kind, partnerName: '' } : { partner: '', kind: 'other' })
          }}>
            {PARTNERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__other">Đối tác khác…</option>
          </select>
        </Field>
        {!o.partner && <Field label="Tên đối tác"><input value={o.partnerName} placeholder="VD: FundedNext, sách Trading in the Zone" onChange={(e) => set({ partnerName: e.target.value })} /></Field>}
        {!o.partner && (
          <Field label="Loại"><select value={o.kind} onChange={(e) => set({ kind: e.target.value as OfferKind })}>{(Object.keys(OFFER_KIND_TEXT) as OfferKind[]).map((k) => <option key={k} value={k}>{OFFER_KIND_TEXT[k]}</option>)}</select></Field>
        )}
        <Field label="Tiêu đề"><input value={o.title} maxLength={80} placeholder="VD: Giảm 20% mọi gói challenge" onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Mã giảm giá" hint="Không bắt buộc"><input value={o.code} onChange={(e) => set({ code: e.target.value.trim() })} /></Field>
        <Field label="Hết hạn" hint="Trống = không hết hạn"><input type="date" value={o.expires} onChange={(e) => set({ expires: e.target.value })} /></Field>
        <Field label="Link riêng" hint="Trống = dùng link giới thiệu đã lưu ở Cá nhân hoá"><input className={badUrl ? 'invalid' : ''} value={o.url} placeholder="https://…" onChange={(e) => set({ url: e.target.value.trim() })} /></Field>
      </div>
      <Field label="Chi tiết"><textarea rows={3} value={o.detail} placeholder="Điều kiện, đối tượng áp dụng, lưu ý…" onChange={(e) => set({ detail: e.target.value })} /></Field>
      <label className="inline" style={{ marginTop: 10 }}><input type="checkbox" className="check" checked={o.pinned} onChange={(e) => set({ pinned: e.target.checked })} /> Ghim lên đầu</label>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="primary" disabled={!o.title.trim() || badUrl || (!o.partner && !o.partnerName.trim())} onClick={() => onSave({ ...o, title: o.title.trim() })}>Lưu</button>
        <button className="ghost" onClick={onCancel}>Huỷ</button>
      </div>
    </section>
  )
}

export default function Offers({ links, bridge, disclaimer }: { links: PartnerLinks; bridge: BridgeState; disclaimer: boolean }) {
  const [offers, setOffers] = usePersistent<Offer[]>('fx.offers', [])
  const [filter, setFilter] = useState<OfferKind | ''>('')
  const [showExpired, setShowExpired] = useState(false)
  const [editing, setEditing] = useState<Offer | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const targets = bridge.status?.telegram.postTargets ?? []

  const list = useMemo(() => sortOffers(offers).filter((o) => (!filter || o.kind === filter) && (showExpired || (daysLeft(o) ?? 0) >= 0)), [offers, filter, showExpired])
  const expiredCount = offers.filter((o) => (daysLeft(o) ?? 0) < 0).length

  const save = (o: Offer) => { setOffers(offers.some((x) => x.id === o.id) ? offers.map((x) => (x.id === o.id ? o : x)) : [...offers, o]); setEditing(null) }
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setMsg({ ok: true, text: `Đã sao chép ${what}.` }) }
    catch { setMsg({ ok: false, text: 'Trình duyệt không cho sao chép tự động; hãy chép tay.' }) }
  }
  const post = async (o: Offer) => {
    const target = targets[0]
    if (!target || !(await ask(`Gửi ưu đãi "${o.title}" lên nhóm "${target}"?`, 'Gửi'))) return
    try { await bridgePost('/telegram/send', { target, text: offerCaption(o, links, disclaimer) }); setMsg({ ok: true, text: `Đã gửi lên "${target}".` }) }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi không rõ' }) }
  }

  return (
    <>
      <h1>Ưu đãi</h1>
      <p className="muted">Gom ưu đãi của sàn, quỹ và công cụ (giảm giá challenge, bonus mở tài khoản, khuyến mãi TradingView…) kèm link giới thiệu của bạn, để chia sẻ cho cộng đồng.</p>
      {editing ? <Editor value={editing} onSave={save} onCancel={() => setEditing(null)} /> : (
        <div className="filters">
          <div className="seg">
            {FILTERS.map((k) => <button key={k || 'all'} className={filter === k ? 'active' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k ? OFFER_KIND_TEXT[k] : 'Tất cả'}</button>)}
          </div>
          {expiredCount > 0 && <label className="inline"><input type="checkbox" className="check" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} /> Hiện {expiredCount} ưu đãi đã hết hạn</label>}
          <button className="primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing(blankOffer())}>+ Thêm ưu đãi</button>
        </div>
      )}
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}

      {list.length === 0 && !editing && (
        <section className="card empty">
          <p>Chưa có ưu đãi nào{filter ? ` loại ${OFFER_KIND_TEXT[filter]}` : ''}.</p>
          <p className="muted small">Khi một quỹ giảm giá hay sàn có bonus mới, thêm vào đây cùng mã và hạn dùng. Ưu đãi hết hạn tự ẩn.</p>
        </section>
      )}
      <div className="offers">
        {list.map((o) => {
          const left = daysLeft(o)
          const url = offerUrl(o, links)
          return (
            <article key={o.id} className={`card offer kind-${o.kind}${left != null && left < 0 ? ' expired' : ''}`}>
              <header>
                <span className="offer-partner">{offerName(o)}</span>
                <span className="chip">{OFFER_KIND_TEXT[o.kind]}</span>
                {o.pinned && <span className="chip pin">Ghim</span>}
                {left != null && <span className={`chip ${left < 0 ? 'off' : left <= 3 ? 'hot' : ''}`}>{left < 0 ? 'Đã hết hạn' : left === 0 ? 'Hết hạn hôm nay' : `Còn ${left} ngày`}</span>}
              </header>
              <h3>{o.title}</h3>
              {o.detail && <p className="offer-detail">{o.detail}</p>}
              {o.code && (
                <div className="offer-code"><code>{o.code}</code><button className="ghost mini" onClick={() => copy(o.code, 'mã')}>Sao chép mã</button></div>
              )}
              <div className="actions">
                {url ? <a className="button primary" href={url} target="_blank" rel="noopener noreferrer">Mở ưu đãi</a> : <span className="muted small">Chưa có link. Thêm link riêng, hoặc lưu link giới thiệu ở Cá nhân hoá.</span>}
                <button onClick={() => copy(offerCaption(o, links, disclaimer), 'nội dung bài đăng')}>Sao chép bài đăng</button>
                {targets.length > 0 && <button onClick={() => post(o)}>Gửi Telegram</button>}
                <button className="ghost" onClick={() => setEditing(o)}>Sửa</button>
                <button className="ghost danger" onClick={async () => { if (await ask(`Xoá ưu đãi "${o.title}"?`, 'Xoá', true)) setOffers(offers.filter((x) => x.id !== o.id)) }}>Xoá</button>
              </div>
            </article>
          )
        })}
      </div>
      <p className="muted small">Chỉ đăng ưu đãi bạn đã kiểm tra trên trang chính thức của đối tác. Ưu đãi lưu trên máy này; khi có máy chủ, cộng đồng sẽ thấy cùng một danh sách.</p>
    </>
  )
}
