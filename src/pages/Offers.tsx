import { useMemo, useState } from 'react'
import { Field } from '../components/Field'
import ImagePick from '../components/ImagePick'
import { ask } from '../lib/ask'
import type { BrandPack } from '../lib/brandpack'
import { bridgePost, type BridgeState } from '../lib/bridge'
import { blankOffer, daysLeft, OFFER_KIND_TEXT, offerCaption, offerName, offerUrl, sortOffers, type Offer, type OfferKind } from '../lib/offers'
import { isWebUrl, type PartnerLinks } from '../lib/partners'

const FILTERS: (OfferKind | '')[] = ['', 'broker', 'prop', 'tool', 'other']

function Editor({ value, partners, onSave, onCancel }: { value: Offer; partners: BrandPack['partners']; onSave: (o: Offer) => void; onCancel: () => void }) {
  const [o, setO] = useState<Offer>({ image: '', cta: '', ...value })
  const set = (p: Partial<Offer>) => setO({ ...o, ...p })
  const badUrl = !!o.url && !isWebUrl(o.url)
  return (
    <section className="card offer-editor">
      <h3>{value.title ? 'Sửa ưu đãi' : 'Thêm ưu đãi'}</h3>
      <div className="editor-grid">
        <ImagePick value={o.image ?? ''} onChange={(image) => set({ image })} />
        <div className="form">
          <div className="row">
            <Field label="Đối tác">
              <select value={o.partner || '__other'} onChange={(e) => {
                const p = partners.find((x) => x.id === e.target.value)
                set(p ? { partner: p.id, kind: p.kind, partnerName: '' } : { partner: '', kind: 'other' })
              }}>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="__other">Đối tác khác…</option>
              </select>
            </Field>
            {!o.partner && <Field label="Tên đối tác"><input value={o.partnerName} placeholder="VD: sách Trading in the Zone" onChange={(e) => set({ partnerName: e.target.value })} /></Field>}
            {!o.partner && <Field label="Loại"><select value={o.kind} onChange={(e) => set({ kind: e.target.value as OfferKind })}>{(Object.keys(OFFER_KIND_TEXT) as OfferKind[]).map((k) => <option key={k} value={k}>{OFFER_KIND_TEXT[k]}</option>)}</select></Field>}
          </div>
          <Field label="Tiêu đề"><input value={o.title} maxLength={80} placeholder="VD: Giảm 20% mọi gói challenge" onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Chi tiết"><textarea rows={3} value={o.detail} placeholder="Điều kiện, đối tượng áp dụng, lưu ý…" onChange={(e) => set({ detail: e.target.value })} /></Field>
          <div className="row">
            <Field label="Mã giảm giá" hint="Không bắt buộc"><input value={o.code} onChange={(e) => set({ code: e.target.value.trim() })} /></Field>
            <Field label="Hết hạn" hint="Trống = không hết hạn"><input type="date" value={o.expires} onChange={(e) => set({ expires: e.target.value })} /></Field>
          </div>
          <div className="row">
            <Field label="Link riêng" hint="Trống = dùng link giới thiệu của đối tác"><input className={badUrl ? 'invalid' : ''} value={o.url} placeholder="https://…" onChange={(e) => set({ url: e.target.value.trim() })} /></Field>
            <Field label="Chữ trên nút" hint="Trống = Nhận ưu đãi"><input value={o.cta ?? ''} maxLength={30} onChange={(e) => set({ cta: e.target.value })} /></Field>
          </div>
          <label className="inline"><input type="checkbox" className="check" checked={o.pinned} onChange={(e) => set({ pinned: e.target.checked })} /> Ghim lên đầu, hiện thành ưu đãi nổi bật</label>
        </div>
      </div>
      <div className="actions" style={{ marginTop: 14 }}>
        <button className="primary" disabled={!o.title.trim() || badUrl || (!o.partner && !o.partnerName.trim())} onClick={() => onSave({ ...o, title: o.title.trim() })}>Lưu</button>
        <button className="ghost" onClick={onCancel}>Huỷ</button>
      </div>
    </section>
  )
}

function Countdown({ o }: { o: Offer }) {
  const left = daysLeft(o)
  if (left == null) return null
  return <span className={`chip ${left < 0 ? 'off' : left <= 3 ? 'hot' : ''}`}>{left < 0 ? 'Đã hết hạn' : left === 0 ? 'Hết hạn hôm nay' : `Còn ${left} ngày`}</span>
}

export default function Offers({ links, bridge, disclaimer, pack, setPack }: { links: PartnerLinks; bridge: BridgeState; disclaimer: boolean; pack: BrandPack; setPack: ((p: BrandPack) => void) | null }) {
  const offers = pack.offers
  const canEdit = !!setPack
  const [filter, setFilter] = useState<OfferKind | ''>('')
  const [showExpired, setShowExpired] = useState(false)
  const [editing, setEditing] = useState<Offer | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const targets = canEdit ? bridge.status?.telegram.postTargets ?? [] : []
  const setOffers = (list: Offer[]) => setPack?.({ ...pack, offers: list })

  const active = useMemo(() => sortOffers(offers).filter((o) => showExpired || (daysLeft(o) ?? 0) >= 0), [offers, showExpired])
  const featured = !filter ? active.find((o) => o.pinned) : undefined
  const list = active.filter((o) => o !== featured && (!filter || o.kind === filter))
  const expiredCount = offers.filter((o) => (daysLeft(o) ?? 0) < 0).length

  const save = (o: Offer) => { setOffers(offers.some((x) => x.id === o.id) ? offers.map((x) => (x.id === o.id ? o : x)) : [...offers, o]); setEditing(null) }
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setMsg({ ok: true, text: `Đã sao chép ${what}.` }) }
    catch { setMsg({ ok: false, text: 'Trình duyệt không cho sao chép tự động; hãy chép tay.' }) }
  }
  const post = async (o: Offer) => {
    const target = targets[0]
    if (!target || !(await ask(`Gửi ưu đãi "${o.title}" lên nhóm "${target}"?`, 'Gửi'))) return
    try { await bridgePost('/telegram/send', { target, text: offerCaption(o, links, disclaimer), image: o.image?.startsWith('data:') ? o.image : '' }); setMsg({ ok: true, text: `Đã gửi lên "${target}".` }) }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi không rõ' }) }
  }

  const actions = (o: Offer) => {
    const url = offerUrl(o, links)
    return (
      <div className="actions">
        {url ? <a className="button primary" href={url} target="_blank" rel="noopener noreferrer">{o.cta || 'Nhận ưu đãi'}</a> : canEdit && <span className="muted small">Chưa có link: thêm link riêng hoặc link đối tác ở Cá nhân hoá.</span>}
        {canEdit && <>
          <button onClick={() => copy(offerCaption(o, links, disclaimer), 'nội dung bài đăng')}>Sao chép bài đăng</button>
          {targets.length > 0 && <button onClick={() => post(o)}>Gửi Telegram</button>}
          <button className="ghost" onClick={() => setEditing(o)}>Sửa</button>
          <button className="ghost danger" onClick={async () => { if (await ask(`Xoá ưu đãi "${o.title}"?`, 'Xoá', true)) setOffers(offers.filter((x) => x.id !== o.id)) }}>Xoá</button>
        </>}
      </div>
    )
  }
  const code = (o: Offer) => o.code && <div className="offer-code"><code>{o.code}</code><button className="ghost mini" onClick={() => copy(o.code, 'mã')}>Sao chép mã</button></div>

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ưu đãi</h1>
          <p className="muted">Giảm giá quỹ, bonus sàn, khuyến mãi công cụ dành cho cộng đồng.</p>
        </div>
        {canEdit && !editing && <button className="primary" onClick={() => setEditing(blankOffer())}>+ Thêm ưu đãi</button>}
      </div>
      {editing && <Editor value={editing} partners={pack.partners} onSave={save} onCancel={() => setEditing(null)} />}
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}

      {featured && (
        <article className={`offer-hero kind-${featured.kind}`}>
          <div className="offer-hero-img">{featured.image ? <img src={featured.image} alt="" /> : <div className="offer-ph"><span>{offerName(featured)}</span></div>}</div>
          <div className="offer-hero-body">
            <header><span className="chip feat">★ Nổi bật</span><span className="offer-partner">{offerName(featured)}</span><Countdown o={featured} /></header>
            <h2>{featured.title}</h2>
            {featured.detail && <p className="offer-detail">{featured.detail}</p>}
            {code(featured)}
            {actions(featured)}
          </div>
        </article>
      )}

      <div className="filters">
        <div className="seg">
          {FILTERS.map((k) => <button key={k || 'all'} className={filter === k ? 'active' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k ? OFFER_KIND_TEXT[k] : 'Tất cả'}</button>)}
        </div>
        {canEdit && expiredCount > 0 && <label className="inline"><input type="checkbox" className="check" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} /> Hiện {expiredCount} ưu đãi đã hết hạn</label>}
      </div>

      {list.length === 0 && !featured && (
        <section className="card empty">
          <p>{canEdit ? 'Chưa có ưu đãi nào.' : 'Hiện chưa có ưu đãi nào. Quay lại sau nhé.'}</p>
          {canEdit && <p className="muted small">Khi một quỹ giảm giá hay sàn có bonus mới, thêm vào đây cùng ảnh, mã và hạn dùng. Ưu đãi hết hạn tự ẩn với người dùng.</p>}
        </section>
      )}
      <div className="offers">
        {list.map((o) => (
          <article key={o.id} className={`offer-card kind-${o.kind}${(daysLeft(o) ?? 0) < 0 ? ' expired' : ''}`}>
            <div className="offer-img">{o.image ? <img src={o.image} alt="" loading="lazy" /> : <div className="offer-ph"><span>{offerName(o)}</span></div>}
              <span className="offer-kind">{OFFER_KIND_TEXT[o.kind]}</span>
            </div>
            <div className="offer-body">
              <header><span className="offer-partner">{offerName(o)}</span>{o.pinned && <span className="chip pin">Ghim</span>}<Countdown o={o} /></header>
              <h3>{o.title}</h3>
              {o.detail && <p className="offer-detail">{o.detail}</p>}
              {code(o)}
              {actions(o)}
            </div>
          </article>
        ))}
      </div>
      <p className="muted small">Đọc kỹ điều khoản trên trang của đối tác trước khi tham gia. Giao dịch có rủi ro mất vốn.</p>
    </>
  )
}
