import { useState } from 'react'
import { Field } from '../components/Field'
import { ask } from '../lib/ask'
import type { BrandPack } from '../lib/brandpack'
import { EDITION } from '../lib/edition'
import { isWebUrl, KIND_TEXT, type PartnerConfig, type PartnerKind } from '../lib/partners'
import { ACCENTS, DEFAULT_PROFILE, DISCLAIMER, type Profile } from '../lib/share'
import { download } from '../lib/store'

interface Props {
  profile: Profile
  setProfile: (p: Profile) => void
  pack: BrandPack
  setPack: ((p: BrandPack) => void) | null
  canEdit: boolean
}

/** Gói cấu hình xuất ra: thương hiệu lấy từ phần Giao diện của bản IB. */
export function exportPack(pack: BrandPack, profile: Profile): BrandPack {
  return { ...pack, brand: { brand: profile.brand, tagline: profile.tagline, accent: profile.accent, link: profile.link, disclaimer: profile.disclaimer }, updatedAt: Date.now() }
}

function PartnerRow({ p, onChange, onRemove }: { p: PartnerConfig; onChange: (p: PartnerConfig) => void; onRemove?: () => void }) {
  const bad = !!p.url && !isWebUrl(p.url)
  const put = (patch: Partial<PartnerConfig>) => onChange({ ...p, ...patch })
  return (
    <tr className={p.visible ? '' : 'row-off'}>
      <td>
        {p.custom ? <input aria-label="Tên đối tác" value={p.name} onChange={(e) => put({ name: e.target.value })} /> : <strong className="nowrap">{p.name}</strong>}
        <div className="muted small">{KIND_TEXT[p.kind]}</div>
      </td>
      <td><input aria-label={`Link ${p.name}`} className={bad ? 'invalid' : ''} value={p.url} placeholder="https://…" onChange={(e) => put({ url: e.target.value.trim() })} />{bad && <div className="field-hint bad-text">Link phải bắt đầu bằng https://</div>}</td>
      <td><input aria-label={`Mã ${p.name}`} value={p.code} placeholder="Mã giảm giá / mã đối tác" onChange={(e) => put({ code: e.target.value.trim() })} /></td>
      <td><input aria-label={`Chữ trên nút ${p.name}`} value={p.cta} maxLength={40} placeholder="VD: Mở tài khoản giảm phí" onChange={(e) => put({ cta: e.target.value })} /></td>
      <td><input aria-label={`Giới thiệu ${p.name}`} value={p.pitch} maxLength={120} placeholder="VD: Hoàn 30% phí cho khách của nhóm" onChange={(e) => put({ pitch: e.target.value })} /></td>
      <td className="nowrap">
        <label className="inline"><input type="checkbox" className="check" checked={p.visible} onChange={(e) => put({ visible: e.target.checked })} /> Hiện</label>
        {onRemove && <button className="ghost icon" aria-label={`Xoá ${p.name}`} onClick={onRemove}>✕</button>}
      </td>
    </tr>
  )
}

export default function Personalize({ profile, setProfile, pack, setPack, canEdit }: Props) {
  const set = (p: Partial<Profile>) => setProfile({ ...profile, ...p })
  const [msg, setMsg] = useState('')
  const [newKind, setNewKind] = useState<PartnerKind>('prop')
  const editPack = (p: Partial<BrandPack>) => setPack?.({ ...pack, ...p })
  const json = () => JSON.stringify(exportPack(pack, profile), null, 2)

  const copyJson = async () => {
    try { await navigator.clipboard.writeText(json()); setMsg('Đã sao chép gói cấu hình.') }
    catch { setMsg('Trình duyệt không cho sao chép tự động.') }
  }
  const importJson = async (f: File) => {
    try {
      const raw = JSON.parse(await f.text())
      if (!(await ask(`Thay toàn bộ link đối tác, ưu đãi, cửa hàng và cộng đồng bằng nội dung của ${f.name}?`, 'Thay', true))) return
      const { normalizePack } = await import('../lib/brandpack')
      const p = normalizePack(raw)
      setPack?.(p)
      setProfile({ ...profile, ...p.brand })
      setMsg(`Đã nạp ${f.name}.`)
    } catch { setMsg('File này không phải gói cấu hình hợp lệ.') }
  }

  return (
    <>
      <h1>Cá nhân hoá</h1>
      {canEdit ? (
        <section className="card form">
          <h3>Thương hiệu</h3>
          <div className="row">
            <Field label="Tên thương hiệu / cộng đồng" hint="Hiện ở góc trên bên trái và trên banner"><input value={profile.brand} maxLength={28} onChange={(e) => set({ brand: e.target.value })} /></Field>
            <Field label="Khẩu hiệu" hint="Không bắt buộc"><input value={profile.tagline} maxLength={48} onChange={(e) => set({ tagline: e.target.value })} /></Field>
          </div>
          <Field label="Link chính" hint="Thêm vào cuối bài đăng và chân banner, ví dụ kênh Telegram của bạn"><input value={profile.link} placeholder="https://…" onChange={(e) => set({ link: e.target.value.trim() })} /></Field>
          <label className="inline wrap"><input type="checkbox" className="check" checked={profile.disclaimer} onChange={(e) => set({ disclaimer: e.target.checked })} /> Thêm dòng cảnh báo vào bài đăng và banner: “{DISCLAIMER}”</label>
        </section>
      ) : null}

      <section className="card form">
        <h3>Giao diện của bạn</h3>
        <div>
          <div className="field-label">Màu nhấn</div>
          <div className="swatches">
            {ACCENTS.map((c) => (
              <button key={c} className={profile.accent === c ? 'swatch active' : 'swatch'} style={{ background: c }} aria-label={`Màu ${c}`} aria-pressed={profile.accent === c} onClick={() => set({ accent: c, accentCustom: true })} />
            ))}
          </div>
        </div>
        <label className="inline wrap"><input type="checkbox" className="check" checked={profile.hideMoney} onChange={(e) => set({ hideMoney: e.target.checked })} /> Ẩn số tiền khi chia sẻ (chỉ hiện pip, R, tỷ lệ thắng)</label>
        <div className="actions"><button className="ghost" onClick={() => setProfile({ ...DEFAULT_PROFILE, ...(canEdit ? {} : { brand: profile.brand, tagline: profile.tagline, link: profile.link, disclaimer: profile.disclaimer }) })}>Về mặc định</button></div>
      </section>

      {canEdit && setPack && (
        <>
          <h2 className="section-title">Dành cho IB <span className="chip pro">Bản trả phí</span></h2>
          <p className="muted small">Phần này chỉ có ở bản IB. Người dùng bản trader không thấy bảng link; họ chỉ thấy nút và câu giới thiệu ở trang Quỹ, Hướng dẫn và Ưu đãi.</p>

          <section className="card">
            <h3>Link giới thiệu</h3>
            <div className="table-wrap">
              <table className="partners">
                <thead><tr><th>Đối tác</th><th>Link giới thiệu</th><th>Mã</th><th>Chữ trên nút</th><th>Câu giới thiệu</th><th /></tr></thead>
                <tbody>
                  {pack.partners.map((p, i) => (
                    <PartnerRow key={p.id} p={p}
                      onChange={(np) => editPack({ partners: pack.partners.map((x, j) => (j === i ? np : x)) })}
                      onRemove={p.custom ? () => editPack({ partners: pack.partners.filter((_, j) => j !== i) }) : undefined} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <select aria-label="Loại đối tác mới" value={newKind} onChange={(e) => setNewKind(e.target.value as PartnerKind)} style={{ width: 'auto' }}>
                {(Object.keys(KIND_TEXT) as PartnerKind[]).map((k) => <option key={k} value={k}>{KIND_TEXT[k]}</option>)}
              </select>
              <button onClick={() => editPack({ partners: [...pack.partners, { id: `x${Date.now()}`, name: 'Đối tác mới', kind: newKind, url: '', code: '', cta: '', pitch: '', visible: true, custom: true }] })}>+ Thêm đối tác</button>
              <span className="muted small">Ví dụ một quỹ hay sàn khác ngoài danh sách sẵn có.</span>
            </div>
          </section>

          <section className="card form">
            <h3>Tính năng Pro cho người dùng</h3>
            <p className="muted small">Tính năng Pro hiện có: chép tín hiệu từ kênh Telegram sang bài chia sẻ. Người chưa có Pro thấy nút “Nâng cấp Pro” dẫn tới link bên dưới.</p>
            <label className="inline wrap"><input type="checkbox" className="check" checked={pack.proForAll} onChange={(e) => editPack({ proForAll: e.target.checked })} /> Mở Pro cho mọi người dùng bản trader</label>
            <Field label="Link nâng cấp Pro" hint="Trang bán, nhóm Telegram hoặc Zalo để liên hệ"><input value={pack.proUrl} placeholder="https://t.me/…" onChange={(e) => editPack({ proUrl: e.target.value.trim() })} /></Field>
          </section>

          <section className="card">
            <h3>Gói cấu hình cho người dùng</h3>
            <p className="muted">Gồm thương hiệu, link đối tác, ưu đãi, cửa hàng, cộng đồng và cài đặt Pro. Bản trader đọc gói này và chỉ hiển thị.</p>
            <ol className="steps">
              <li>Sửa xong ở các trang Ưu đãi, Cửa hàng, Cộng đồng và mục này.</li>
              <li>Tải <code>brand.json</code>. Đăng nó lên một chỗ có link công khai (GitHub Gist, trang web của bạn), hoặc đặt vào thư mục <code>public/</code> trước khi build bản trader.</li>
              <li>Mỗi lần có ưu đãi mới, sửa và đăng lại file. Người dùng mở app là thấy bản mới, không phải cài lại.</li>
            </ol>
            <div className="actions">
              <button className="primary" onClick={() => download('brand.json', json(), 'application/json')}>Tải brand.json</button>
              <button onClick={copyJson}>Sao chép JSON</button>
              <label className="button file-btn">Nạp gói từ file<input type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} /></label>
              <span className="muted small">{(json().length / 1024).toFixed(0)} KB · {pack.offers.length} ưu đãi · {pack.products.length} sản phẩm · {pack.communities.length} cộng đồng</span>
            </div>
            {msg && <p className="notice">{msg}</p>}
          </section>
        </>
      )}
      {EDITION === 'owner' && !canEdit && <p className="notice">Bạn đang xem như người dùng bản trader. Tắt “Xem như người dùng” ở cuối thanh bên để chỉnh cấu hình.</p>}
      <p className="muted small">Tiền tệ tài khoản, % rủi ro mặc định và đòn bẩy chỉnh ở trang Tính lot. Múi giờ máy chủ chỉnh ở trang Nhật ký.</p>
    </>
  )
}
