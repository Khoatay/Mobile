import { Field } from '../components/Field'
import { ACCENTS, DEFAULT_PROFILE, DISCLAIMER, type Profile } from '../lib/share'

export default function Personalize({ profile, setProfile }: { profile: Profile; setProfile: (p: Profile) => void }) {
  const set = (p: Partial<Profile>) => setProfile({ ...profile, ...p })
  return (
    <>
      <h1>Cá nhân hoá</h1>
      <section className="card form">
        <div className="row">
          <Field label="Tên thương hiệu / cộng đồng" hint="Hiện ở góc trên bên trái và trên banner"><input value={profile.brand} maxLength={28} onChange={(e) => set({ brand: e.target.value })} /></Field>
          <Field label="Khẩu hiệu" hint="Không bắt buộc"><input value={profile.tagline} maxLength={48} onChange={(e) => set({ tagline: e.target.value })} /></Field>
        </div>
        <Field label="Link giới thiệu (IB, affiliate)" hint="Được thêm vào cuối bài đăng và chân banner"><input value={profile.link} placeholder="https://…" onChange={(e) => set({ link: e.target.value.trim() })} /></Field>
        <div>
          <div className="field-label">Màu nhấn</div>
          <div className="swatches">
            {ACCENTS.map((c) => (
              <button key={c} className={profile.accent === c ? 'swatch active' : 'swatch'} style={{ background: c }} aria-label={`Màu ${c}`} aria-pressed={profile.accent === c} onClick={() => set({ accent: c })} />
            ))}
          </div>
        </div>
        <label className="inline wrap"><input type="checkbox" className="check" checked={profile.hideMoney} onChange={(e) => set({ hideMoney: e.target.checked })} /> Ẩn số tiền khi chia sẻ (chỉ hiện pip, R, tỷ lệ thắng)</label>
        <label className="inline wrap"><input type="checkbox" className="check" checked={profile.disclaimer} onChange={(e) => set({ disclaimer: e.target.checked })} /> Thêm dòng cảnh báo vào bài đăng và banner: “{DISCLAIMER}”</label>
        <div className="actions"><button className="ghost" onClick={() => setProfile(DEFAULT_PROFILE)}>Về mặc định</button></div>
      </section>
      <p className="muted small">Tiền tệ tài khoản, % rủi ro mặc định và đòn bẩy chỉnh ở trang Tính lot. Múi giờ máy chủ chỉnh ở trang Nhật ký.</p>
    </>
  )
}
