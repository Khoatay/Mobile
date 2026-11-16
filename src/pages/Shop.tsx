import { useState } from 'react'
import { Field } from '../components/Field'
import ImagePick from '../components/ImagePick'
import { ask } from '../lib/ask'
import type { BrandPack } from '../lib/brandpack'
import { blankProduct, CATEGORY_TEXT, type Product, type ProductCategory } from '../lib/catalog'
import { isWebUrl } from '../lib/partners'

const CAT_ICON: Record<ProductCategory, string> = { ea: '🤖', mt5: '📈', tv: '📊', course: '🎓', pdf: '📚', other: '✨' }

function Editor({ value, onSave, onCancel }: { value: Product; onSave: (p: Product) => void; onCancel: () => void }) {
  const [p, setP] = useState(value)
  const [features, setFeatures] = useState(value.features.join('\n'))
  const set = (patch: Partial<Product>) => setP({ ...p, ...patch })
  const bad = !!p.buyUrl && !isWebUrl(p.buyUrl)
  return (
    <section className="card offer-editor">
      <h3>{value.name ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h3>
      <div className="editor-grid">
        <ImagePick value={p.image} onChange={(image) => set({ image })} label="Ảnh sản phẩm" />
        <div className="form">
          <div className="row">
            <Field label="Loại"><select value={p.category} onChange={(e) => set({ category: e.target.value as ProductCategory })}>{(Object.keys(CATEGORY_TEXT) as ProductCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_TEXT[c]}</option>)}</select></Field>
            <Field label="Nhãn" hint="VD: Bán chạy, Mới, Giảm 30%"><input value={p.badge} maxLength={20} onChange={(e) => set({ badge: e.target.value })} /></Field>
          </div>
          <Field label="Tên sản phẩm"><input value={p.name} maxLength={60} placeholder="VD: Gold Scalper EA" onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Câu giới thiệu ngắn"><input value={p.tagline} maxLength={100} placeholder="VD: Bot scalping vàng phiên Âu–Mỹ, SL cứng mỗi lệnh" onChange={(e) => set({ tagline: e.target.value })} /></Field>
          <Field label="Mô tả"><textarea rows={4} value={p.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Điểm nổi bật" hint="Mỗi dòng một ý"><textarea rows={4} value={features} placeholder={'Chạy trên MT5\nCó bản demo dùng thử 7 ngày\nHỗ trợ cài đặt qua Telegram'} onChange={(e) => setFeatures(e.target.value)} /></Field>
          <div className="row">
            <Field label="Giá"><input value={p.price} placeholder="VD: 1.990.000đ hoặc 49 USD/tháng" onChange={(e) => set({ price: e.target.value })} /></Field>
            <Field label="Giá cũ" hint="Không bắt buộc, hiện gạch ngang"><input value={p.oldPrice} onChange={(e) => set({ oldPrice: e.target.value })} /></Field>
          </div>
          <div className="row">
            <Field label="Link mua / liên hệ" hint="Trang thanh toán, Telegram hoặc Zalo"><input className={bad ? 'invalid' : ''} value={p.buyUrl} placeholder="https://…" onChange={(e) => set({ buyUrl: e.target.value.trim() })} /></Field>
            <Field label="Chữ trên nút" hint="Trống = Mua ngay"><input value={p.buyLabel} maxLength={30} onChange={(e) => set({ buyLabel: e.target.value })} /></Field>
          </div>
          <label className="inline"><input type="checkbox" className="check" checked={p.visible} onChange={(e) => set({ visible: e.target.checked })} /> Hiện cho người dùng</label>
        </div>
      </div>
      <div className="actions" style={{ marginTop: 14 }}>
        <button className="primary" disabled={!p.name.trim() || bad} onClick={() => onSave({ ...p, name: p.name.trim(), features: features.split('\n').map((x) => x.trim()).filter(Boolean) })}>Lưu</button>
        <button className="ghost" onClick={onCancel}>Huỷ</button>
      </div>
    </section>
  )
}

export default function Shop({ pack, setPack }: { pack: BrandPack; setPack: ((p: BrandPack) => void) | null }) {
  const canEdit = !!setPack
  const [cat, setCat] = useState<ProductCategory | ''>('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const products = pack.products.filter((p) => canEdit || p.visible)
  const cats = (Object.keys(CATEGORY_TEXT) as ProductCategory[]).filter((c) => products.some((p) => p.category === c))
  const list = products.filter((p) => !cat || p.category === cat).sort((a, b) => Number(!!b.badge) - Number(!!a.badge) || b.createdAt - a.createdAt)
  const setProducts = (l: Product[]) => setPack?.({ ...pack, products: l })
  const save = (p: Product) => { setProducts(pack.products.some((x) => x.id === p.id) ? pack.products.map((x) => (x.id === p.id ? p : x)) : [...pack.products, p]); setEditing(null) }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cửa hàng</h1>
          <p className="muted">Bot trade, indicator cho MT5 và TradingView, khoá học và tài liệu.</p>
        </div>
        {canEdit && !editing && <button className="primary" onClick={() => setEditing(blankProduct())}>+ Thêm sản phẩm</button>}
      </div>
      {editing && <Editor value={editing} onSave={save} onCancel={() => setEditing(null)} />}

      {cats.length > 1 && (
        <div className="filters">
          <div className="seg">
            <button className={!cat ? 'active' : ''} aria-pressed={!cat} onClick={() => setCat('')}>Tất cả</button>
            {cats.map((c) => <button key={c} className={cat === c ? 'active' : ''} aria-pressed={cat === c} onClick={() => setCat(c)}>{CATEGORY_TEXT[c]}</button>)}
          </div>
        </div>
      )}
      {list.length === 0 && (
        <section className="card empty">
          <p>{canEdit ? 'Chưa có sản phẩm nào.' : 'Cửa hàng đang được chuẩn bị. Quay lại sau nhé.'}</p>
          {canEdit && <p className="muted small">Thêm bot, indicator, khoá học hay PDF kèm ảnh, giá và link mua. Việc thanh toán diễn ra ở link bạn đặt (trang bán, Telegram, Zalo).</p>}
        </section>
      )}
      <div className="products">
        {list.map((p) => (
          <article key={p.id} className={`product cat-${p.category}${p.visible ? '' : ' hidden-item'}`}>
            <div className="product-img">
              {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="product-ph"><span aria-hidden="true">{CAT_ICON[p.category]}</span></div>}
              {p.badge && <span className="product-badge">{p.badge}</span>}
            </div>
            <div className="product-body">
              <span className="product-cat">{CAT_ICON[p.category]} {CATEGORY_TEXT[p.category]}{!p.visible && ' · Đang ẩn'}</span>
              <h3>{p.name}</h3>
              {p.tagline && <p className="product-tagline">{p.tagline}</p>}
              {p.features.length > 0 && <ul className="product-features">{p.features.slice(0, open === p.id ? undefined : 3).map((f, i) => <li key={i}>{f}</li>)}</ul>}
              {open === p.id && p.description && <p className="offer-detail">{p.description}</p>}
              {(p.description || p.features.length > 3) && <button className="ghost mini" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Thu gọn' : 'Xem chi tiết'}</button>}
              <div className="product-foot">
                <div className="price">{p.oldPrice && <s>{p.oldPrice}</s>}<strong>{p.price || 'Liên hệ'}</strong></div>
                {p.buyUrl ? <a className="button primary" href={p.buyUrl} target="_blank" rel="noopener noreferrer">{p.buyLabel || 'Mua ngay'}</a> : <span className="muted small">Chưa có link mua</span>}
              </div>
              {canEdit && (
                <div className="actions owner-actions">
                  <button className="ghost" onClick={() => setEditing(p)}>Sửa</button>
                  <button className="ghost" onClick={() => setProducts(pack.products.map((x) => (x.id === p.id ? { ...x, visible: !x.visible } : x)))}>{p.visible ? 'Ẩn' : 'Hiện'}</button>
                  <button className="ghost danger" onClick={async () => { if (await ask(`Xoá sản phẩm "${p.name}"?`, 'Xoá', true)) setProducts(pack.products.filter((x) => x.id !== p.id)) }}>Xoá</button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      <p className="muted small">Bot và indicator không đảm bảo lợi nhuận; kết quả quá khứ không phản ánh tương lai. Hãy chạy thử trên tài khoản demo trước.</p>
    </>
  )
}
