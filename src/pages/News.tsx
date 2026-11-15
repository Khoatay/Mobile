import { useEffect, useMemo, useState } from 'react'
import { bridgeGet, type BridgeState, type TgMessage } from '../lib/bridge'
import { currenciesOf, filterEvents, imminent, type CalEvent } from '../lib/news'
import { demoMessages, parseSignal } from '../lib/signals'

const IMPACT_VI: Record<string, string> = { High: '▲▲▲ Cao', Medium: '▲▲ Vừa', Low: '▲ Thấp', Holiday: 'Nghỉ lễ' }
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })
const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

export default function News({ bridge, messages: live }: { bridge: BridgeState; messages: TgMessage[] }) {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [calError, setCalError] = useState('')
  const [minImpact, setMinImpact] = useState(3)
  const [mineOnly, setMineOnly] = useState(false)
  const [channel, setChannel] = useState('')
  const [query, setQuery] = useState('')
  const [demo, setDemo] = useState(false)
  const [now, setNow] = useState(Date.now())
  const tgOn = !!bridge.status?.telegram.connected

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!bridge.online) return
    let stop = false
    const load = () => bridgeGet<CalEvent[]>('/calendar')
      .then((e) => { if (!stop) { setEvents(e); setCalError('') } })
      .catch((e) => { if (!stop) setCalError(e instanceof Error ? e.message : 'Lỗi không rõ') })
    load()
    const id = setInterval(load, 30 * 60_000)
    return () => { stop = true; clearInterval(id) }
  }, [bridge.online])

  const held = useMemo(() => currenciesOf(bridge.accounts.flatMap((a) => a.positions.map((p) => p.symbol))), [bridge.accounts])
  const soon = imminent(events, held, now)
  const shown = filterEvents(events, minImpact, mineOnly ? held : null)
  const days = [...new Set(shown.map((e) => new Date(Date.parse(e.date)).toDateString()))]

  const messages = demo ? demoMessages(now) : live
  const channels = [...new Set(messages.map((m) => m.channel))].sort()
  const feed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return messages
      .filter((m) => (!channel || m.channel === channel) && (!q || m.text.toLowerCase().includes(q)))
      .sort((a, b) => b.date - a.date)
      .slice(0, 150)
  }, [messages, channel, query])

  return (
    <>
      <h1>Tin tức</h1>
      {soon.length > 0 && (
        <p className="warn">⚠ Trong 60 phút tới có tin mức cao ảnh hưởng lệnh đang mở: {soon.map((e) => `${e.currency} ${e.title} lúc ${timeLabel(Date.parse(e.date))}`).join('; ')}</p>
      )}

      <section className="card">
        <div className="card-head">
          <h3>Lịch kinh tế tuần này</h3>
          <div className="actions">
            <div className="seg">
              {[[3, 'Chỉ tin mạnh'], [2, 'Từ mức vừa'], [0, 'Tất cả']].map(([v, label]) => (
                <button key={v} className={minImpact === v ? 'active' : ''} aria-pressed={minImpact === v} onClick={() => setMinImpact(v as number)}>{label}</button>
              ))}
            </div>
            <label className="inline"><input type="checkbox" className="check" checked={mineOnly} disabled={!held.length} onChange={(e) => setMineOnly(e.target.checked)} /> Chỉ đồng tiền tôi đang giữ lệnh{held.length > 0 && ` (${held.join(', ')})`}</label>
          </div>
        </div>
        {!bridge.online ? <p className="muted">Cần chạy chương trình nền (bridge) để tải lịch. Xem trang Hướng dẫn.</p>
          : calError ? <p className="notice bad">⚠ {calError}</p>
          : shown.length === 0 ? <p className="muted">Không có sự kiện nào khớp bộ lọc.</p>
          : days.map((d) => (
            <div key={d} className="cal-day">
              <div className="cal-date">{dayLabel(new Date(d).getTime())}</div>
              <table>
                <tbody>
                  {shown.filter((e) => new Date(Date.parse(e.date)).toDateString() === d).map((e, i) => {
                    const t = Date.parse(e.date)
                    return (
                      <tr key={i} className={t < now ? 'past' : ''}>
                        <td className="nowrap num cal-time">{timeLabel(t)}</td>
                        <td className="cal-ccy strong">{e.currency}</td>
                        <td className="nowrap cal-impact">{IMPACT_VI[e.impact] ?? e.impact}</td>
                        <td>{e.title}</td>
                        <td className="num muted nowrap">{e.forecast && `Dự báo ${e.forecast}`}{e.forecast && e.previous && ' · '}{e.previous && `Kỳ trước ${e.previous}`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        <p className="muted small">Giờ hiển thị theo giờ máy tính của bạn. Nguồn: lịch công khai của Forex Factory, cập nhật mỗi giờ.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Tin từ các kênh Telegram {demo && '(tin mẫu)'}</h3>
          <div className="actions">
            <select aria-label="Kênh" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Mọi kênh</option>
              {channels.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input className="search" placeholder="Tìm trong tin (USD, Fed, vàng…)" value={query} onChange={(e) => setQuery(e.target.value)} />
            {!tgOn && <button onClick={() => setDemo(!demo)}>{demo ? 'Thoát tin mẫu' : 'Xem thử với tin mẫu'}</button>}
          </div>
        </div>
        {!tgOn && !demo && <p className="muted">Chưa kết nối Telegram. Khai báo kênh trong <code>bridge/config.json</code>; cách làm ở trang Hướng dẫn.</p>}
        {feed.map((m) => (
          <article key={m.channel + m.id} className="post">
            <header>
              <strong>{m.channel}</strong>
              <span className="muted small">{new Date(m.date * 1000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              {parseSignal(m) && <span className="chip">Lệnh</span>}
            </header>
            <div className="msg wide">{m.text}</div>
          </article>
        ))}
        {(tgOn || demo) && feed.length === 0 && <p className="muted">Không có tin nào khớp.</p>}
        <p className="muted small">Hiện tối đa 150 tin mới nhất. Facebook và X chưa hỗ trợ: Facebook không có cách chính thức để đọc trang của người khác, còn X cần gói API trả phí.</p>
      </section>
    </>
  )
}
