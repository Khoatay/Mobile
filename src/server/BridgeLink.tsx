import { useEffect, useState } from 'react'
import { api } from '../lib/server'

interface Status { online: boolean; lastSeen: number; hasToken: boolean }

/** Nối máy chạy MT5 (PC hoặc VPS Windows của khách) với tài khoản web: tạo mã, xem trạng thái. */
export default function BridgeLink() {
  const [st, setSt] = useState<Status | null>(null)
  const [token, setToken] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const load = () => api<Status>('/bridge/status').then(setSt).catch((e) => setErr(e.message))
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])
  const create = async () => {
    if (st?.hasToken && !window.confirm('Tạo mã mới thì mã cũ hết hiệu lực: máy đang nối sẽ phải dán mã mới. Tiếp tục?')) return
    try { setToken((await api<{ token: string }>('/bridge/token', {})).token); setCopied(false) } catch (e) { setErr((e as Error).message) }
  }
  const snippet = token ? `"server": {"url": "${location.origin}", "token": "${token}"},` : ''
  return (
    <section className="card bridge-link">
      <h3>Kết nối máy chạy MT5</h3>
      <p className="muted">Tài khoản, Bảo vệ, Copy lệnh và AI phân tích cần một máy Windows có MT5: máy tính của bạn, hoặc VPS Windows bạn thuê. Máy đó chạy bridge và tự nối lên Golden Duck, nên bạn mở web ở đâu (kể cả điện thoại) cũng dùng được. Mật khẩu MT5 chỉ nằm trên máy đó.</p>
      <p className="bridge-status">
        <span className={st?.online ? 'led on' : 'led'} /> {st == null ? 'Đang kiểm tra…' : st.online ? 'Máy MT5 đang kết nối' : st.lastSeen ? `Mất kết nối từ ${new Date(st.lastSeen).toLocaleString('vi-VN')}` : 'Chưa có máy nào kết nối'}
      </p>
      {token ? (
        <>
          <ol className="steps">
            <li>Trên máy chạy MT5, mở file <code>bridge/config.json</code>.</li>
            <li>Dán dòng dưới đây ngay sau dấu <code>{'{'}</code> đầu tiên:
              <pre className="code-line">{snippet}</pre>
              <button className="mini" onClick={() => { navigator.clipboard?.writeText(snippet); setCopied(true) }}>{copied ? '✓ Đã chép' : 'Chép'}</button>
            </li>
            <li>Chạy lại bridge. Vài giây sau dòng trạng thái ở trên chuyển sang “đang kết nối”.</li>
          </ol>
          <p className="muted small">Mã này chỉ hiện một lần. Ai có mã sẽ điều khiển được bridge của bạn qua web: đừng gửi cho người khác.</p>
        </>
      ) : (
        <button className="primary" onClick={create}>{st?.hasToken ? 'Tạo mã kết nối mới' : 'Tạo mã kết nối'}</button>
      )}
      {err && <p className="notice bad">⚠ {err}</p>}
    </section>
  )
}
