import { Field } from '../components/Field'
import { EDITION } from '../lib/edition'
import { ACCENTS, DEFAULT_PROFILE, DISCLAIMER, type Profile } from '../lib/share'

interface Props {
  profile: Profile
  setProfile: (p: Profile) => void
  canEdit: boolean
}

export default function Personalize({ profile, setProfile, canEdit }: Props) {
  const set = (p: Partial<Profile>) => setProfile({ ...profile, ...p })
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

      {EDITION === 'owner' && !canEdit && <p className="notice">Bạn đang xem như người dùng bản trader. Tắt “Xem như người dùng” ở cuối thanh bên để chỉnh thương hiệu. Link giới thiệu và gói cấu hình nằm ở trang Gói Pro.</p>}
      <p className="muted small">Tiền tệ tài khoản, % rủi ro mặc định và đòn bẩy chỉnh ở trang Tính lot. Múi giờ máy chủ chỉnh ở trang Nhật ký.</p>
    </>
  )
}
