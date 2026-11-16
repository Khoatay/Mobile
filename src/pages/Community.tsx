import { useState } from 'react'
import { Field } from '../components/Field'
import ImagePick from '../components/ImagePick'
import { ask } from '../lib/ask'
import type { BrandPack } from '../lib/brandpack'
import { blankCommunity, COMMUNITY_KIND_TEXT, telegramUrl, type Community as Item, type CommunityKind } from '../lib/catalog'

function Editor({ value, onSave, onCancel }: { value: Item; onSave: (c: Item) => void; onCancel: () => void }) {
  const [c, setC] = useState(value)
  const set = (p: Partial<Item>) => setC({ ...c, ...p })
  return (
    <section className="card offer-editor">
      <h3>{value.name ? 'Sửa nhóm' : 'Thêm nhóm'}</h3>
      <div className="editor-grid">
        <ImagePick value={c.image} onChange={(image) => set({ image })} ratio="1 / 1" label="Ảnh đại diện nhóm" />
        <div className="form">
          <div className="row">
            <Field label="Loại"><select value={c.kind} onChange={(e) => set({ kind: e.target.value as CommunityKind })}>{(Object.keys(COMMUNITY_KIND_TEXT) as CommunityKind[]).map((k) => <option key={k} value={k}>{COMMUNITY_KIND_TEXT[k]}</option>)}</select></Field>
            <Field label="Tên"><input value={c.name} maxLength={50} placeholder="VD: Thư viện sách trading" onChange={(e) => set({ name: e.target.value })} /></Field>
          </div>
          <Field label="Mô tả"><textarea rows={2} value={c.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Quà / quyền lợi" hint="VD: Tải miễn phí 50 sách PDF về trading"><input value={c.perk} maxLength={100} onChange={(e) => set({ perk: e.target.value })} /></Field>
          <Field label="Điều kiện tham gia" hint="Trống = ai cũng vào được"><input value={c.condition} maxLength={100} placeholder="VD: Dành cho khách mở tài khoản dưới link IB" onChange={(e) => set({ condition: e.target.value })} /></Field>
          <Field label="Link Telegram" hint="https://t.me/…, t.me/… hoặc @ten_kenh"><input value={c.url} onChange={(e) => set({ url: e.target.value.trim() })} /></Field>
          <label className="inline"><input type="checkbox" className="check" checked={c.visible} onChange={(e) => set({ visible: e.target.checked })} /> Hiện cho người dùng</label>
        </div>
      </div>
      <div className="actions" style={{ marginTop: 14 }}>
        <button className="primary" disabled={!c.name.trim() || !c.url.trim()} onClick={() => onSave({ ...c, name: c.name.trim(), url: telegramUrl(c.url) })}>Lưu</button>
        <button className="ghost" onClick={onCancel}>Huỷ</button>
      </div>
    </section>
  )
}

export default function Community({ pack, setPack }: { pack: BrandPack; setPack: ((p: BrandPack) => void) | null }) {
  const canEdit = !!setPack
  const [editing, setEditing] = useState<Item | null>(null)
  const items = pack.communities.filter((c) => canEdit || c.visible)
  const setItems = (l: Item[]) => setPack?.({ ...pack, communities: l })
  const save = (c: Item) => { setItems(pack.communities.some((x) => x.id === c.id) ? pack.communities.map((x) => (x.id === c.id ? c : x)) : [...pack.communities, c]); setEditing(null) }
  const move = (id: string, d: number) => {
    const i = pack.communities.findIndex((x) => x.id === id), j = i + d
    if (j < 0 || j >= pack.communities.length) return
    const l = [...pack.communities]; [l[i], l[j]] = [l[j], l[i]]; setItems(l)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Nhóm cộng đồng</h1>
          <p className="muted">Các kênh và nhóm Telegram để nhận quà, tài liệu miễn phí và trò chuyện cùng mọi người.</p>
        </div>
        {canEdit && !editing && <button className="primary" onClick={() => setEditing(blankCommunity())}>+ Thêm nhóm</button>}
      </div>
      {editing && <Editor value={editing} onSave={save} onCancel={() => setEditing(null)} />}
      {items.length === 0 && (
        <section className="card empty">
          <p>{canEdit ? 'Chưa có nhóm nào.' : 'Chưa có nhóm nào. Quay lại sau nhé.'}</p>
          {canEdit && <p className="muted small">Ví dụ: kênh tải sách PDF miễn phí, kênh chia sẻ khoá học, nhóm chat chung, nhóm VIP cho khách IB.</p>}
        </section>
      )}
      <div className="communities">
        {items.map((c) => (
          <article key={c.id} className={`community kind-${c.kind}${c.visible ? '' : ' hidden-item'}`}>
            <div className="community-top">
              {c.image ? <img className="community-img" src={c.image} alt="" /> : <span className="community-img ph" aria-hidden="true">{(c.name.replace(/\(.*?\)/g, '').match(/[\p{L}\p{N}]/u)?.[0] ?? '#').toUpperCase()}</span>}
              <div className="community-id">
                <span className="chip">{COMMUNITY_KIND_TEXT[c.kind]}{!c.visible && ' · Đang ẩn'}</span>
                <h3>{c.name}</h3>
              </div>
            </div>
            {c.description && <p className="offer-detail">{c.description}</p>}
            {c.perk && <div className="perk"><span aria-hidden="true">🎁</span>{c.perk}</div>}
            {c.condition && <p className="muted small">Điều kiện: {c.condition}</p>}
            <div className="actions" style={{ marginTop: 'auto' }}>
              <a className="button primary tg" href={c.url} target="_blank" rel="noopener noreferrer">Tham gia trên Telegram</a>
              {canEdit && <>
                <button className="ghost icon" aria-label="Lên trước" onClick={() => move(c.id, -1)}>↑</button>
                <button className="ghost icon" aria-label="Xuống sau" onClick={() => move(c.id, 1)}>↓</button>
                <button className="ghost" onClick={() => setEditing(c)}>Sửa</button>
                <button className="ghost danger" onClick={async () => { if (await ask(`Xoá nhóm "${c.name}"?`, 'Xoá', true)) setItems(pack.communities.filter((x) => x.id !== c.id)) }}>Xoá</button>
              </>}
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
