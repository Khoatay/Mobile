import { useRef, useState } from 'react'
import { Field } from '../components/Field'
import AiSettings from '../components/AiSettings'
import { BRAND_LOGO, logoOf } from '../lib/brand'
import { squareAvatar } from '../lib/user'
import { EDITION } from '../lib/edition'
import { ACCENTS, DEFAULT_PROFILE, DISCLAIMER, type Profile } from '../lib/share'

interface Props {
  /** Bridge đang chạy (để cài AI). */
  online: boolean
  profile: Profile
  setProfile: (p: Profile) => void
  canEdit: boolean
}

export default function Personalize({ profile, setProfile, canEdit, online }: Props) {
  const set = (p: Partial<Profile>) => setProfile({ ...profile, ...p })
  const file = useRef<HTMLInputElement>(null)
  const [logoErr, setLogoErr] = useState('')
  const pickLogo = async (f: File) => {
    try { set({ logo: await squareAvatar(f, 256, true) }); setLogoErr('') } catch (e) { setLogoErr(e instanceof Error ? e.message : 'Không đọc được ảnh này') }
  }
  return (
    <>
      <h1>Cá nhân hoá</h1>
      {canEdit ? (
        <section className="card form">
          <h3>Thương hiệu</h3>
          <div className="logo-pick">
            <button type="button" className="logo-pick-preview" onClick={() => file.current?.click()} aria-label="Đổi logo"
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) pickLogo(f) }}>
              <img src={logoOf(profile)} alt="" />
            </button>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickLogo(f); e.target.value = '' }} />
            <div>
              <div className="field-label">Logo</div>
              <p className="muted small">Hiện ở góc app, trên tab trình duyệt, banner chia sẻ và trang thành tích. Ảnh vuông, PNG nền trong suốt là đẹp nhất; app tự cắt vuông và thu về 256px.</p>
              <div className="actions">
                <button type="button" onClick={() => file.current?.click()}>{profile.logo ? 'Đổi logo' : 'Tải logo của bạn'}</button>
                {profile.logo && <button type="button" className="ghost" onClick={() => set({ logo: '' })}>Dùng lại logo Golden Duck</button>}
              </div>
              {logoErr && <p className="notice bad">⚠ {logoErr}</p>}
              {!profile.logo && <p className="muted small">Đang dùng logo mặc định <img src={BRAND_LOGO} alt="" className="logo-inline" /> Golden Duck.</p>}
            </div>
          </div>
          <div className="row">
            <Field label="Tên thương hiệu / cộng đồng" hint="Hiện ở góc trên bên trái và trên banner"><input value={profile.brand} maxLength={28} onChange={(e) => set({ brand: e.target.value })} /></Field>
            <Field label="Khẩu hiệu" hint="Không bắt buộc"><input value={profile.tagline} maxLength={48} onChange={(e) => set({ tagline: e.target.value })} /></Field>
          </div>
          <Field label="Website" hint="Tên miền riêng, ví dụ goldenduck.vn. Để trống cho tới khi có; điền rồi thì hiện trên ảnh chia sẻ, bài đăng, trang thành tích và trong app">
            <input value={profile.website ?? ''} placeholder="Chưa có (điền khi mua tên miền)" onChange={(e) => set({ website: e.target.value.trim() })} />
          </Field>
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
        <div className="actions"><button className="ghost" onClick={() => setProfile({ ...DEFAULT_PROFILE, ...(canEdit ? {} : { brand: profile.brand, logo: profile.logo, website: profile.website, tagline: profile.tagline, link: profile.link, disclaimer: profile.disclaimer }) })}>Về mặc định</button></div>
      </section>

      {canEdit && online && <AiSettings />}

      {EDITION === 'owner' && !canEdit && <p className="notice">Bạn đang xem như người dùng bản trader. Tắt “Xem như người dùng” ở cuối thanh bên để chỉnh thương hiệu. Link giới thiệu và gói cấu hình nằm ở trang Gói Pro.</p>}
      <p className="muted small">Tiền tệ tài khoản, % rủi ro mặc định và đòn bẩy chỉnh ở trang Tính lot. Múi giờ máy chủ chỉnh ở trang Nhật ký.</p>
    </>
  )
}
