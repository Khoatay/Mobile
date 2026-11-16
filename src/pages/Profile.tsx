import { useRef, useState } from 'react'
import Avatar from '../components/Avatar'
import { Field } from '../components/Field'
import { EXPERIENCE, MARKETS, squareAvatar, STYLES, validUsername, type UserProfile } from '../lib/user'
import { computeStats } from '../lib/stats'
import { pct } from '../lib/format'
import type { Trade } from '../lib/types'

export default function Profile({ user, setUser, trades }: { user: UserProfile; setUser: (u: UserProfile) => void; trades: Trade[] }) {
  const [err, setErr] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const set = (p: Partial<UserProfile>) => setUser({ ...user, ...p })
  const s = computeStats(trades, 0)
  const badUser = !!user.username && !validUsername(user.username)

  async function pick(f: File) {
    try { set({ avatar: await squareAvatar(f) }); setErr('') } catch (e) { setErr(e instanceof Error ? e.message : 'Lỗi không rõ') }
  }

  return (
    <>
      <h1>Hồ sơ</h1>
      <section className="card profile-head">
        <button className="avatar-pick" onClick={() => file.current?.click()} aria-label="Đổi ảnh đại diện">
          <Avatar src={user.avatar} name={user.displayName || user.username} size={96} />
          <span className="avatar-edit">Đổi ảnh</span>
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }} />
        <div className="profile-id">
          <div className="profile-name">{user.displayName || 'Chưa đặt tên'}</div>
          <div className="muted">{user.username ? `@${user.username}` : 'Chưa có tên người dùng'}</div>
          <div className="chips">
            {user.style && <span className="chip">{user.style}</span>}
            {user.experience && <span className="chip">{user.experience}</span>}
            {user.markets.map((m) => <span key={m} className="chip">{m}</span>)}
          </div>
        </div>
        <div className="profile-stats">
          <div><strong>{s.n}</strong><span>lệnh</span></div>
          <div><strong>{s.n ? pct(s.winRate, 0) : '–'}</strong><span>thắng</span></div>
          <div><strong>{s.n ? (Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞') : '–'}</strong><span>profit factor</span></div>
        </div>
        {user.avatar && <button className="ghost small-btn" onClick={() => set({ avatar: '' })}>Bỏ ảnh</button>}
      </section>
      {err && <p className="notice bad">⚠ {err}</p>}

      <section className="card form">
        <div className="row">
          <Field label="Tên hiển thị"><input value={user.displayName} maxLength={40} placeholder="VD: Minh Gold" onChange={(e) => set({ displayName: e.target.value })} /></Field>
          <Field label="Tên người dùng" hint="Chữ thường, số, dấu chấm, gạch dưới; 3–20 ký tự">
            <input className={badUser ? 'invalid' : ''} value={user.username} maxLength={20} placeholder="minh.gold" onChange={(e) => set({ username: e.target.value.toLowerCase().replace(/\s/g, '') })} />
          </Field>
        </div>
        <Field label="Giới thiệu"><textarea rows={3} maxLength={300} value={user.bio} placeholder="Bạn giao dịch thế nào, đang theo đuổi mục tiêu gì…" onChange={(e) => set({ bio: e.target.value })} /></Field>
        <div className="row">
          <Field label="Phong cách"><select value={user.style} onChange={(e) => set({ style: e.target.value })}><option value="">Chưa chọn</option>{STYLES.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Kinh nghiệm"><select value={user.experience} onChange={(e) => set({ experience: e.target.value })}><option value="">Chưa chọn</option>{EXPERIENCE.map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>
        <div>
          <div className="field-label">Thị trường hay giao dịch</div>
          <div className="chips" style={{ marginTop: 6 }}>
            {MARKETS.map((m) => {
              const on = user.markets.includes(m)
              return <button key={m} className={on ? 'chip-toggle on' : 'chip-toggle'} aria-pressed={on} onClick={() => set({ markets: on ? user.markets.filter((x) => x !== m) : [...user.markets, m] })}>{m}</button>
            })}
          </div>
        </div>
        <div className="row">
          <Field label="Telegram"><input value={user.telegram} placeholder="@ten_cua_ban" onChange={(e) => set({ telegram: e.target.value.trim() })} /></Field>
          <Field label="Facebook"><input value={user.facebook} placeholder="https://facebook.com/…" onChange={(e) => set({ facebook: e.target.value.trim() })} /></Field>
        </div>
      </section>

      <section className="card">
        <h3>Đăng nhập</h3>
        <p className="muted">Hồ sơ hiện chỉ lưu trên trình duyệt của máy này. Đăng nhập bằng Google, Facebook hoặc tên người dùng và mật khẩu sẽ có khi app nối với máy chủ, để hồ sơ, bài đăng và quyền VIP đi theo bạn trên mọi máy.</p>
      </section>
    </>
  )
}
