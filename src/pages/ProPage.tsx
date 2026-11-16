import { useState } from 'react'
import { Field } from '../components/Field'
import Icon, { type IconName } from '../components/Icon'
import { ask } from '../lib/ask'
import { normalizePack, type BrandPack } from '../lib/brandpack'
import { isWebUrl, KIND_TEXT, type PartnerConfig, type PartnerKind } from '../lib/partners'
import { PRO_FEATURES } from '../lib/pro'
import type { Profile } from '../lib/share'
import { download } from '../lib/store'

interface Props {
  pack: BrandPack
  setPack: ((p: BrandPack) => void) | null
  profile: Profile
  setProfile: (p: Profile) => void
  isPro: boolean
  goTab: (tab: string) => void
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

export default function ProPage({ pack, setPack, profile, setProfile, isPro, goTab }: Props) {
  const canEdit = !!setPack
  const [msg, setMsg] = useState('')
  const [newKind, setNewKind] = useState<PartnerKind>('prop')
  const editPack = (p: Partial<BrandPack>) => setPack?.({ ...pack, ...p })
  const json = () => JSON.stringify(exportPack(pack, profile), null, 2)
  const isProFeature = (id: string) => pack.proFeatures.includes(id)

  const copyJson = async () => {
    try { await navigator.clipboard.writeText(json()); setMsg('Đã sao chép gói cấu hình.') }
    catch { setMsg('Trình duyệt không cho sao chép tự động.') }
  }
  const importJson = async (f: File) => {
    try {
      const raw = JSON.parse(await f.text())
      if (!(await ask(`Thay toàn bộ link đối tác, ưu đãi, cửa hàng, cộng đồng và cài đặt Pro bằng nội dung của ${f.name}?`, 'Thay', true))) return
      const p = normalizePack(raw)
      setPack?.(p)
      setProfile({ ...profile, ...p.brand })
      setMsg(`Đã nạp ${f.name}.`)
    } catch { setMsg('File này không phải gói cấu hình hợp lệ.') }
  }

  const proCount = PRO_FEATURES.filter((f) => isProFeature(f.id)).length

  return (
    <>
      <section className={isPro ? 'pro-hero on' : 'pro-hero'}>
        <div className="pro-hero-text">
          <span className="pro-crown" aria-hidden="true">★</span>
          <h1>Gói Pro</h1>
          <p>{canEdit ? 'Chọn tính năng nào dành cho người dùng Pro, đặt giá và link nâng cấp. Người dùng bản trader xem trang này để biết họ có gì.' : isPro ? 'Bạn đang dùng gói Pro. Mọi tính năng bên dưới đã mở.' : 'Mở thêm các công cụ đăng tín hiệu và phân tích nâng cao.'}</p>
          {pack.proPrice && <p className="pro-price">{pack.proPrice}</p>}
        </div>
        <div className="pro-hero-side">
          <span className={isPro ? 'pro-status on' : 'pro-status'}>{canEdit ? 'Bản IB · mọi tính năng đã mở' : isPro ? '✓ Đang dùng Pro' : 'Đang dùng bản miễn phí'}</span>
          {!isPro && (pack.proUrl ? <a className="button primary big" href={pack.proUrl} target="_blank" rel="noopener noreferrer">Nâng cấp Pro</a> : <span className="muted small">Liên hệ quản trị cộng đồng để nâng cấp.</span>)}
        </div>
      </section>

      <h2 className="section-title">Tính năng {canEdit && <span className="muted small">· {proCount} tính năng đang là Pro</span>}</h2>
      <div className="pro-features">
        {PRO_FEATURES.map((f) => {
          const pro = isProFeature(f.id)
          const open = !pro || isPro
          return (
            <article key={f.id} className={`pro-feature${pro ? ' is-pro' : ''}${open ? '' : ' locked'}`}>
              <span className="pro-feature-icon"><Icon name={f.icon as IconName} size={22} /></span>
              <div className="pro-feature-body">
                <div className="pro-feature-head">
                  <h3>{f.name}</h3>
                  <span className={`chip ${pro ? 'pro' : ''}`}>{pro ? (open ? 'Pro' : '🔒 Pro') : 'Miễn phí'}</span>
                </div>
                <p className="muted small">{f.desc}</p>
                <div className="actions">
                  <button className={open ? '' : 'ghost'} disabled={!open} onClick={() => goTab(f.tab)}>{open ? 'Mở' : 'Cần Pro'}</button>
                  {canEdit && (
                    <label className="inline toggle">
                      <input type="checkbox" className="check" checked={pro} onChange={(e) => editPack({ proFeatures: e.target.checked ? [...pack.proFeatures, f.id] : pack.proFeatures.filter((x) => x !== f.id) })} />
                      Là tính năng Pro
                    </label>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {setPack && (
        <>
          <h2 className="section-title">Cài đặt Pro</h2>
          <section className="card form">
            <div className="row">
              <Field label="Giá / cách có Pro" hint="Hiện ở đầu trang này"><input value={pack.proPrice} maxLength={80} placeholder="VD: 199.000đ/tháng, miễn phí cho khách IB" onChange={(e) => editPack({ proPrice: e.target.value })} /></Field>
              <Field label="Link nâng cấp" hint="Trang bán, nhóm Telegram hoặc Zalo"><input className={pack.proUrl && !isWebUrl(pack.proUrl) ? 'invalid' : ''} value={pack.proUrl} placeholder="https://t.me/…" onChange={(e) => editPack({ proUrl: e.target.value.trim() })} /></Field>
            </div>
            <label className="inline wrap"><input type="checkbox" className="check" checked={pack.proForAll} onChange={(e) => editPack({ proForAll: e.target.checked })} /> Mở Pro cho mọi người dùng bản trader (ví dụ thời gian đầu, hoặc cộng đồng nội bộ)</label>
            <p className="muted small">Hiện Pro được bật cho tất cả hoặc không ai. Bật theo từng người (ai trả tiền thì có) cần máy chủ và đăng nhập.</p>
          </section>

          <h2 className="section-title">Dành cho IB</h2>
          <section className="card">
            <h3>Link giới thiệu</h3>
            <p className="muted small">Người dùng bản trader không thấy bảng này; họ chỉ thấy nút và câu giới thiệu ở trang Quỹ, Hướng dẫn và Ưu đãi.</p>
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
              <button onClick={() => editPack({ partners: [...pack.partners, { id: `x${Date.now()}`, name: 'Đối tác mới', kind: newKind, url: '', code: '', cta: '', pitch: '', visible: true, custom: true } as PartnerConfig] })}>+ Thêm đối tác</button>
            </div>
          </section>

          <section className="card">
            <h3>Gói cấu hình cho người dùng</h3>
            <p className="muted">Gồm thương hiệu, link đối tác, ưu đãi, cửa hàng, nhóm cộng đồng và cài đặt Pro. Bản trader đọc gói này và chỉ hiển thị.</p>
            <ol className="steps">
              <li>Sửa xong ở trang Ưu đãi, Cửa hàng, Nhóm cộng đồng và trang này.</li>
              <li>Tải <code>brand.json</code>, đăng lên một chỗ có link công khai (GitHub Gist, trang web của bạn), hoặc đặt vào thư mục <code>public/</code> trước khi build bản trader.</li>
              <li>Mỗi lần thay đổi, sửa và đăng lại file. Người dùng mở app là thấy bản mới.</li>
            </ol>
            <div className="actions">
              <button className="primary" onClick={() => download('brand.json', json(), 'application/json')}>Tải brand.json</button>
              <button onClick={copyJson}>Sao chép JSON</button>
              <label className="button file-btn">Nạp gói từ file<input type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} /></label>
              <span className="muted small">{(json().length / 1024).toFixed(0)} KB · {pack.offers.length} ưu đãi · {pack.products.length} sản phẩm · {pack.communities.length} nhóm</span>
            </div>
            {msg && <p className="notice">{msg}</p>}
          </section>
        </>
      )}
    </>
  )
}
