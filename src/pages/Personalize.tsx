import { Field } from '../components/Field'
import { isWebUrl, KIND_TEXT, PARTNERS } from '../lib/partners'
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
      <section className="card">
        <h3>Link giới thiệu của bạn</h3>
        <p className="muted small">Link IB của sàn, link affiliate của quỹ và công cụ. App chèn chúng vào trang Quỹ (khi tài khoản qua vòng hoặc vi phạm), mục Quỹ và Sàn trong Hướng dẫn, và trang Ưu đãi.</p>
        <div className="table-wrap">
          <table className="partners">
            <thead><tr><th>Đối tác</th><th>Loại</th><th>Link giới thiệu</th><th>Mã giảm giá / mã đối tác</th></tr></thead>
            <tbody>
              {PARTNERS.map((p) => {
                const v = profile.partners?.[p.id] ?? { url: '' }
                const bad = !!v.url && !isWebUrl(v.url)
                const put = (patch: Partial<{ url: string; code: string }>) => set({ partners: { ...profile.partners, [p.id]: { ...v, ...patch } } })
                return (
                  <tr key={p.id}>
                    <td className="strong nowrap">{p.name}</td>
                    <td className="muted nowrap">{KIND_TEXT[p.kind]}</td>
                    <td><input aria-label={`Link ${p.name}`} className={bad ? 'invalid' : ''} value={v.url} placeholder="https://…" onChange={(e) => put({ url: e.target.value.trim() })} />{bad && <div className="field-hint bad-text">Link phải bắt đầu bằng https://</div>}</td>
                    <td><input aria-label={`Mã ${p.name}`} value={v.code ?? ''} placeholder="Không bắt buộc" onChange={(e) => put({ code: e.target.value.trim() })} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted small">Tiền tệ tài khoản, % rủi ro mặc định và đòn bẩy chỉnh ở trang Tính lot. Múi giờ máy chủ chỉnh ở trang Nhật ký.</p>
    </>
  )
}
