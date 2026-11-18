import type { NewsWatchState } from '../lib/newsWatch'

/** Thanh cảnh báo tin đang nhắc, hiện ở mọi trang. Bấm "Tắt" để bridge thôi nhắc (cả Telegram). */
export default function NewsAlertBar({ state, ack, onOpen }: { state: NewsWatchState | null; ack: (key?: string) => void; onOpen?: () => void }) {
  const list = state?.active ?? []
  if (!list.length) return null
  const t = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="news-alert-bar" role="alert">
      <span className="bell ringing" aria-hidden="true">🔔</span>
      <div className="news-alert-list">
        {list.slice(0, 3).map((a) => (
          <div key={a.key}>
            <strong>{a.currency} · {a.title}</strong> lúc {t(a.at)} (còn {Math.max(0, Math.round((a.at - Date.now()) / 60_000))} phút){a.count > 1 && <span className="muted small"> · nhắc lần {a.count}</span>}
            <button className="ghost mini" onClick={() => ack(a.key)}>Tắt</button>
          </div>
        ))}
        {list.length > 3 && <div className="muted small">và {list.length - 3} tin khác</div>}
      </div>
      <div className="actions">
        {onOpen && <button className="ghost mini" onClick={onOpen}>Xem lịch</button>}
        {list.length > 1 && <button className="primary mini" onClick={() => ack()}>Tắt tất cả</button>}
      </div>
    </div>
  )
}
