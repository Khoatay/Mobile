import { useEffect, useMemo, useState } from 'react'
import { bridgeGet, type BridgeState, type TgMessage } from '../lib/bridge'
import { currenciesOf, filterEvents, imminent, type CalEvent } from '../lib/news'
import { demoMessages, parseSignal } from '../lib/signals'
import { CURRENCY_COLOR, DEFAULT_WATCH, IMPACT_CLASS, isWatched, newsKey, type NewsWatchConfig, type NewsWatchState } from '../lib/newsWatch'

type Watch = { state: NewsWatchState | null; save: (p: Partial<NewsWatchConfig>) => Promise<void>; ack: (key?: string) => Promise<void> }
const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'CNY']

const IMPACT_VI: Record<string, string> = { High: '▲▲▲ Cao', Medium: '▲▲ Vừa', Low: '▲ Thấp', Holiday: 'Nghỉ lễ' }
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })
const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

export default function News({ bridge, messages: live, watch }: { bridge: BridgeState; messages: TgMessage[]; watch: Watch }) {
  const cfg = { ...DEFAULT_WATCH, ...watch.state?.config }
  const acks = new Set(watch.state?.acks ?? [])
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
  const nextKey = shown.find((e) => Date.parse(e.date) >= now)
  // Bấm chuông: tin chưa bật thì bật riêng; tin bật riêng thì tắt; tin bật theo quy tắc thì tắt riêng tin đó.
  const toggleBell = (e: CalEvent) => {
    const k = newsKey(e), how = isWatched(e, cfg)
    if (how === 'event') return watch.save({ events: cfg.events.filter((x) => x !== k) })
    if (how === 'rule' && !acks.has(k)) return watch.ack(k)
    return watch.save({ events: [...cfg.events, k] })
  }

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

      {bridge.online && (
        <section className="card news-watch">
          <div className="card-head">
            <h3>🔔 Cảnh báo tin</h3>
            <label className="switch"><input type="checkbox" checked={cfg.enabled} onChange={(e) => watch.save({ enabled: e.target.checked })} /><span>{cfg.enabled ? 'Đang bật' : 'Tắt'}</span></label>
          </div>
          <p className="muted small">Bấm chuông ở từng tin trong lịch, hoặc tự bật cho mọi tin của đồng tiền bạn chọn. Bridge canh giờ nên vẫn báo Telegram khi đã đóng app.</p>
          <div className="watch-grid">
            <div>
              <div className="field-label">Tự bật cho tin</div>
              <div className="seg">
                {([['High', 'Mạnh'], ['Medium', 'Từ vừa'], ['Low', 'Mọi mức']] as const).map(([v, l]) => <button key={v} className={cfg.impact === v ? 'active' : ''} aria-pressed={cfg.impact === v} onClick={() => watch.save({ impact: v })}>{l}</button>)}
              </div>
              <div className="ccy-chips">
                {CCYS.map((c) => { const on = cfg.currencies.includes(c); return <button key={c} className={on ? 'ccy-chip on' : 'ccy-chip'} style={{ '--ccy': CURRENCY_COLOR[c] } as React.CSSProperties} aria-pressed={on} onClick={() => watch.save({ currencies: on ? cfg.currencies.filter((x) => x !== c) : [...cfg.currencies, c] })}>{c}</button> })}
              </div>
            </div>
            <div>
              <div className="field-label">Báo trước</div>
              <div className="seg">{[5, 15, 30, 60].map((m) => <button key={m} className={cfg.lead_min === m ? 'active' : ''} aria-pressed={cfg.lead_min === m} onClick={() => watch.save({ lead_min: m })}>{m} phút</button>)}</div>
              <div className="field-label" style={{ marginTop: 10 }}>Nhắc lại tới khi bấm Tắt</div>
              <div className="seg">{[[0, 'Không'], [1, '1 phút'], [2, '2 phút'], [3, '3 phút'], [5, '5 phút']].map(([m, l]) => <button key={m} className={cfg.repeat_min === m ? 'active' : ''} aria-pressed={cfg.repeat_min === m} onClick={() => watch.save({ repeat_min: m as number })}>{l}</button>)}</div>
            </div>
            <div>
              <div className="field-label">Gửi về</div>
              <label className="inline"><input type="checkbox" className="check" checked readOnly disabled /> Trong app (thanh cảnh báo + tiếng chuông)</label>
              <label className="inline"><input type="checkbox" className="check" checked={cfg.telegram} onChange={(e) => watch.save({ telegram: e.target.checked })} /> Telegram {watch.state && !watch.state.telegram && <span className="neg small">(chưa nối, xem trang Hồ sơ)</span>}</label>
            </div>
          </div>
          {(watch.state?.active.length ?? 0) > 0 && (
            <div className="actions"><span className="small">{watch.state!.active.length} tin đang nhắc</span><button className="primary mini" onClick={() => watch.ack()}>Tắt tất cả</button></div>
          )}
        </section>
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
                    const k = newsKey(e)
                    const how = isWatched(e, cfg)
                    const bell = cfg.enabled && how && !acks.has(k)
                    const ringing = watch.state?.active.some((a) => a.key === k)
                    return (
                      <tr key={i} className={`${IMPACT_CLASS[e.impact] ?? ''}${t < now ? ' past' : ''}${nextKey === e ? ' next' : ''}`}>
                        <td className="nowrap num cal-time">{timeLabel(t)}{nextKey === e && <span className="next-tag">Sắp ra</span>}</td>
                        <td><span className="ccy-tag" style={{ '--ccy': CURRENCY_COLOR[e.currency] ?? '#7a8599' } as React.CSSProperties}>{e.currency}</span></td>
                        <td className="nowrap"><span className={`imp-badge ${IMPACT_CLASS[e.impact] ?? ''}`}>{IMPACT_VI[e.impact] ?? e.impact}</span></td>
                        <td>{e.title}</td>
                        <td className="num muted nowrap">{e.forecast && `Dự báo ${e.forecast}`}{e.forecast && e.previous && ' · '}{e.previous && `Kỳ trước ${e.previous}`}</td>
                        <td className="bell-cell">
                          {e.impact !== 'Holiday' && t >= now && bridge.online && (
                            <button className={`bell${bell ? ' on' : ''}${ringing ? ' ringing' : ''}`} onClick={() => toggleBell(e)}
                              aria-pressed={!!bell} aria-label={bell ? `Tắt cảnh báo ${e.title}` : `Bật cảnh báo ${e.title}`}
                              title={bell ? (how === 'rule' ? `Đang báo theo quy tắc ${e.currency}. Bấm để tắt riêng tin này` : 'Đang báo. Bấm để tắt') : 'Bấm để báo trước tin này'}>
                              {bell ? '🔔' : '🔕'}
                            </button>
                          )}
                        </td>
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
