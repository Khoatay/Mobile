import { useState } from 'react'
import { BRAND_LOGO, BRAND_NAME } from '../lib/brand'
import { api, type Me } from '../lib/server'

/** Đăng nhập / đăng ký bằng email. Một màn hình, chuyển qua lại bằng một nút. */
export default function Login({ onDone }: { onDone: (m: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const reg = mode === 'register'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (reg && !agree) { setErr('Hãy đọc và đồng ý lưu ý rủi ro trước khi tạo tài khoản'); return }
    setBusy(true); setErr('')
    try { onDone(await api<Me>(reg ? '/auth/register' : '/auth/login', reg ? { email, password, name } : { email, password })) }
    catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="lite srv-login">
      <img className="srv-login-logo" src={BRAND_LOGO} alt="" />
      <h1>{BRAND_NAME}</h1>
      <p className="muted">Theo dõi kênh tín hiệu bạn chọn, tính lot an toàn, hỏi AI khi chưa hiểu.</p>
      <form className="lite-card srv-form" onSubmit={submit}>
        <h2>{reg ? 'Tạo tài khoản' : 'Đăng nhập'}</h2>
        {reg && <label>Tên gọi (không bắt buộc)<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={60} /></label>}
        <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" /></label>
        <label>Mật khẩu<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={reg ? 'new-password' : 'current-password'} />
          {reg && <small className="muted">Ít nhất 8 ký tự</small>}</label>
        {reg && (
          <label className="srv-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>Tôi hiểu giao dịch forex và vàng có thể mất tiền. Tín hiệu đến từ các kênh tôi tự chọn, không phải lời khuyên của {BRAND_NAME}.</span></label>
        )}
        {err && <p className="notice bad">⚠ {err}</p>}
        <button className="primary lite-cta" disabled={busy}>{busy ? 'Đang gửi…' : reg ? 'Tạo tài khoản' : 'Đăng nhập'}</button>
        <button type="button" className="lite-link" onClick={() => { setMode(reg ? 'login' : 'register'); setErr('') }}>
          {reg ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Tạo mới miễn phí'}
        </button>
      </form>
    </div>
  )
}
