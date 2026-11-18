import { useEffect, useState } from 'react'
import { bridgeGet, bridgePost } from '../lib/bridge'

interface BotStatus { configured: boolean; username: string; linked: boolean; chat_name: string; code: string; link: string; error: string }
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

/**
 * Nối Telegram để nhận cảnh báo: tạo bot với @BotFather, dán token, bấm Start một lần.
 * App hỏi bridge mỗi 3 giây cho tới khi thấy đã nối, nên người dùng không phải bấm gì thêm.
 */
export default function TelegramConnect({ online }: { online: boolean }) {
  const [st, setSt] = useState<BotStatus | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = () => bridgeGet<BotStatus>('/tgbot').then(setSt).catch(() => {})
  useEffect(() => {
    if (!online) return
    load()
    const id = setInterval(load, st?.linked ? 30_000 : 3_000)
    return () => clearInterval(id)
  }, [online, st?.linked])
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null)
    try { await fn(); await load(); setMsg({ ok: true, text: ok }) } catch (e) { setMsg({ ok: false, text: errText(e) }) } finally { setBusy(false) }
  }

  return (
    <section className="card tg-connect">
      <h3>Nhận cảnh báo qua Telegram</h3>
      {!online ? (
        <p className="muted">Cần chạy bridge trên máy tính để gửi cảnh báo. Xem trang Hướng dẫn.</p>
      ) : !st ? <p className="muted">Đang kiểm tra…</p> : st.linked ? (
        <>
          <p className="tg-ok">✅ Đã nối với <b>{st.chat_name || 'Telegram của bạn'}</b> qua bot <a href={`https://t.me/${st.username}`} target="_blank" rel="noreferrer">@{st.username}</a></p>
          <p className="muted small">Cảnh báo bảo vệ tài khoản và tin tức sẽ gửi vào chat này. Gõ <b>tắt</b> trong chat để dừng cảnh báo tin đang nhắc lặp.</p>
          <div className="actions">
            <button disabled={busy} onClick={() => run(() => bridgePost('/tgbot/test', {}), 'Đã gửi tin thử. Kiểm tra Telegram trên điện thoại.')}>Gửi tin thử</button>
            <button className="ghost danger" disabled={busy} onClick={() => run(() => bridgePost('/tgbot/unlink', {}), 'Đã ngắt. Bấm Mở Telegram để nối lại.')}>Ngắt kết nối</button>
          </div>
        </>
      ) : st.configured ? (
        <>
          <ol className="tg-steps">
            <li className="done">Đã có bot <b>@{st.username}</b>.</li>
            <li>Bấm nút dưới, Telegram mở ra, bấm <b>Start</b> (Bắt đầu). App tự nhận trong vài giây.</li>
          </ol>
          <div className="actions">
            <a className="button primary" href={st.link} target="_blank" rel="noreferrer">Mở Telegram để kết nối</a>
            <span className="muted small"><span className="spinner" aria-hidden="true" /> Đang chờ bạn bấm Start…</span>
          </div>
          <p className="muted small">Mã kết nối: <code>{st.code}</code>. Nếu nút không mở được Telegram, mở @{st.username} và gửi: <code>/start {st.code}</code></p>
          <button className="ghost mini" disabled={busy} onClick={() => run(() => bridgePost('/tgbot/remove', {}), 'Đã bỏ bot. Có thể dán token khác.')}>Dùng bot khác</button>
        </>
      ) : (
        <>
          <p className="muted small">Một lần duy nhất, khoảng 2 phút. Không cần số điện thoại hay mật khẩu Telegram.</p>
          <ol className="tg-steps">
            <li>Mở <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> trên Telegram, gửi <code>/newbot</code>, đặt tên bất kỳ (ví dụ <i>Golden Duck của Khoa</i>) và tên đăng nhập kết thúc bằng <code>bot</code>.</li>
            <li>BotFather gửi lại một dòng token dạng <code>123456789:AA...</code>. Chép và dán vào ô dưới.</li>
            <li>Bấm <b>Mở Telegram để kết nối</b> rồi bấm <b>Start</b>. Xong.</li>
          </ol>
          <div className="actions">
            <input className="tg-token" type="password" autoComplete="off" placeholder="Dán token của bot" value={token} onChange={(e) => setToken(e.target.value.trim())} />
            <button className="primary" disabled={busy || !token} onClick={() => run(async () => { await bridgePost('/tgbot/token', { token }); setToken('') }, 'Token hợp lệ. Bước cuối: bấm Mở Telegram để kết nối.')}>{busy ? 'Đang kiểm tra…' : 'Lưu token'}</button>
          </div>
          <p className="muted small">Token chỉ lưu trên máy chạy bridge (file <code>bridge/telegram_bot.json</code>), không gửi đi đâu khác. Đừng đưa token cho người khác.</p>
        </>
      )}
      {st?.error && <p className="notice bad">⚠ {st.error}</p>}
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
    </section>
  )
}
