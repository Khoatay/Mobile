import { useEffect, useState } from 'react'
import { BRAND_NAME } from '../lib/brand'
import { PREVIEW } from '../lib/bridge'
import { api, type Me } from '../lib/server'
import BridgeLink from './BridgeLink'
import { MyAiCard } from './AiPicker'

/** Tài khoản: gói, lượt AI hôm nay, nối Telegram một chạm, đăng xuất. */
export default function ServerMe({ me, setMe }: { me: Me; setMe: (m: Me | null) => void }) {
  const [waiting, setWaiting] = useState(false)
  const [err, setErr] = useState('')

  // Sau khi mở Telegram: hỏi máy chủ vài giây một lần cho tới khi khách bấm Start xong.
  useEffect(() => {
    if (!waiting || me.telegram.linked) { setWaiting(false); return }
    const t = setInterval(() => api<Me>('/me').then((m) => { if (m.telegram.linked) setMe(m) }).catch(() => {}), 3000)
    const stop = setTimeout(() => setWaiting(false), 5 * 60_000)
    return () => { clearInterval(t); clearTimeout(stop) }
  }, [waiting, me.telegram.linked])

  function connect() {
    if (PREVIEW) { setWaiting(true); setTimeout(() => api<Me>('/me/telegram/demo-link', {}).then(setMe), 1500); return }
    window.open(me.telegram.link, '_blank', 'noopener')
    setWaiting(true)
  }
  const run = async (p: Promise<unknown>) => { try { await p } catch (e) { setErr((e as Error).message) } }

  return (
    <>
      <h1>Tài khoản &amp; gói</h1>
      <section className="lite-card">
        <div className="lite-label">Đăng nhập bằng</div>
        <strong>{me.name || me.email}</strong>{me.name && <small className="muted"> · {me.email}</small>}
        <div className="srv-plan">
          <span className={`srv-badge ${me.plan}`}>{me.plan === 'pro' ? 'Pro' : 'Miễn phí'}</span>
          {me.planUntil && <small className="muted">đến {new Date(me.planUntil).toLocaleDateString('vi-VN')}</small>}
        </div>
        <ul className="srv-limits">
          <li>Theo dõi tối đa <strong>{me.limits.channels}</strong> kênh</li>
          <li>Hỏi AI: <strong>{me.chatToday}/{me.limits.chatPerDay}</strong> tin hôm nay</li>
        </ul>
      </section>

      <BridgeLink />

      <section className="lite-card">
        <div className="lite-label">Nhận lệnh qua Telegram</div>
        {me.telegram.linked ? (
          <>
            <p>✅ Đã nối{me.telegram.name ? ` với ${me.telegram.name}` : ''}. Lệnh mới từ kênh đang bật chuông sẽ gửi vào Telegram của bạn.</p>
            <button className="lite-link danger" onClick={() => run(api<Me>('/me/telegram/unlink', {}).then(setMe))}>Ngắt kết nối</button>
          </>
        ) : me.telegram.link || PREVIEW ? (
          <>
            <p className="muted">Một chạm: mở Telegram, bấm <strong>Start</strong> là xong. Không cần nhập gì.</p>
            <button className="primary lite-cta" onClick={connect} disabled={waiting}>{waiting ? 'Đang chờ bạn bấm Start…' : 'Nối Telegram'}</button>
          </>
        ) : (
          <p className="muted">Máy chủ chưa bật bot Telegram. Thử lại sau.</p>
        )}
      </section>

      {me.advanced && (
        <details className="lite-card srv-adv">
          <summary><strong>Nâng cao</strong><small className="muted"> · khoá AI riêng, chọn hãng và model</small></summary>
          <MyAiCard />
        </details>
      )}

      <section className="lite-card">
        <div className="lite-label">Lưu ý</div>
        <p className="small muted">Tín hiệu đến từ các kênh bạn tự thêm. {BRAND_NAME} không đánh giá, không giới thiệu và không chịu trách nhiệm về kết quả của các kênh đó. Giao dịch có thể mất tiền; chỉ dùng số tiền bạn chấp nhận mất.</p>
      </section>

      {err && <p className="notice bad">⚠ {err}</p>}
      <button className="lite-cta srv-logout" onClick={() => run(api('/auth/logout', {}).then(() => setMe(null)))}>Đăng xuất</button>
    </>
  )
}
