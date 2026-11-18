import { useEffect, useMemo, useState } from 'react'
import { api, useFeed, type ChannelRow, type Me } from '../lib/server'
import { parseSignal, riskReward, type Signal } from '../lib/signals'

const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  return m < 1 ? 'vừa xong' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.floor(m / 60)} giờ trước` : `${Math.floor(m / 1440)} ngày trước`
}

/** Tín hiệu: khách tự thêm kênh Telegram muốn theo dõi; máy chủ đọc tin và lọc ra lệnh. */
export default function ServerSignals({ me, goCalc, goMe }: { me: Me; goCalc: () => void; goMe: () => void }) {
  const [channels, setChannels] = useState<ChannelRow[] | null>(null)
  const [ref, setRef] = useState('')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const [manage, setManage] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const feed = useFeed(!!channels?.length)

  useEffect(() => { api<ChannelRow[]>('/channels').then((c) => { setChannels(c); if (!c.length) setManage(true) }).catch((e) => setErr(e.message)) }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!ref.trim()) return
    setAdding(true); setErr('')
    try { setChannels(await api<ChannelRow[]>('/channels/add', { ref })); setRef(''); feed.refresh() }
    catch (e) { setErr((e as Error).message) }
    finally { setAdding(false) }
  }
  const act = async (path: string, body: unknown) => { try { setChannels(await api<ChannelRow[]>(path, body)) } catch (e) { setErr((e as Error).message) } }

  const signals = useMemo(() => feed.items.map(parseSignal).filter((s): s is Signal => !!s).sort((a, b) => b.time - a.time), [feed.items])
  const plain = useMemo(() => feed.items.filter((m) => !parseSignal(m)).sort((a, b) => b.date - a.date), [feed.items])
  const full = channels && channels.length >= me.limits.channels

  return (
    <>
      <h1>Tín hiệu</h1>
      <p className="muted">Lệnh từ các kênh Telegram <strong>bạn tự thêm</strong>. App chỉ đọc và lọc ra lệnh, không đánh giá hay giới thiệu kênh nào.</p>

      <section className="lite-card">
        <div className="srv-row">
          <div className="lite-label">Kênh của bạn · {channels?.length ?? 0}/{me.limits.channels}</div>
          {!!channels?.length && <button className="lite-link mini" onClick={() => setManage(!manage)}>{manage ? 'Xong' : 'Sửa'}</button>}
        </div>
        {channels?.map((c) => (
          <div key={c.id} className="srv-channel">
            <div>
              <strong>{c.title || c.ref}</strong>
              <small className="muted">{c.kind === 'invite' ? 'Kênh riêng' : `@${c.ref}`}{c.last_at ? ` · tin mới nhất ${ago(c.last_at)}` : ''}</small>
            </div>
            {manage ? (
              <button className="lite-link mini danger" onClick={() => confirm(`Bỏ theo dõi ${c.title || c.ref}?`) && act('/channels/remove', { id: c.id })}>Bỏ</button>
            ) : (
              <button className={`srv-bell${c.notify ? ' on' : ''}`} aria-pressed={!!c.notify} title={c.notify ? 'Đang báo qua Telegram' : 'Không báo'} onClick={() => act('/channels/notify', { id: c.id, on: !c.notify })}>{c.notify ? '🔔' : '🔕'}</button>
            )}
          </div>
        ))}
        {(manage || !channels?.length) && !full && (
          <form className="srv-add" onSubmit={add}>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="@tenkenh hoặc link t.me/…" aria-label="Kênh muốn theo dõi" autoCapitalize="off" autoCorrect="off" />
            <button className="primary" disabled={adding || !ref.trim()}>{adding ? 'Đang vào…' : 'Thêm'}</button>
          </form>
        )}
        {(manage || !channels?.length) && (
          <p className="muted small">Mở kênh trong Telegram → bấm tên kênh → chép <strong>link</strong> hoặc <strong>@tên</strong> rồi dán vào đây. Kênh riêng thì dán link mời (t.me/+…).</p>
        )}
        {full && manage && <p className="muted small">Đã đủ {me.limits.channels} kênh của gói. Bỏ bớt kênh để thêm kênh khác.</p>}
        {err && <p className="notice bad">⚠ {err}</p>}
        {!!channels?.length && !me.telegram.linked && (
          <button className="lite-link" onClick={goMe}>🔔 Nối Telegram để nhận lệnh mới ngay trên điện thoại →</button>
        )}
      </section>

      {!!channels?.length && (
        <>
          <div className="srv-row">
            <div className="lite-label">{showAll ? 'Mọi tin' : `Lệnh gần đây · ${signals.length}`}</div>
            <button className="lite-link mini" onClick={() => setShowAll(!showAll)}>{showAll ? 'Chỉ xem lệnh' : 'Xem cả tin thường'}</button>
          </div>
          {!showAll && !signals.length && <p className="muted">Chưa thấy lệnh nào trong 7 ngày qua. Lệnh mới sẽ hiện ở đây.</p>}
          {!showAll && signals.slice(0, 50).map((s) => <SignalCard key={s.id} s={s} goCalc={goCalc} />)}
          {showAll && plain.slice(0, 50).map((m) => (
            <div key={`${m.channel}:${m.id}`} className="lite-card srv-msg"><small className="muted">{m.channel} · {ago(m.date * 1000)}</small><p>{m.text}</p></div>
          ))}
          <p className="muted small">Chép lệnh tự động sang MT5 đang được làm. Hiện tại bạn vào lệnh tay trên MT5 theo thông tin ở trên.</p>
        </>
      )}
    </>
  )
}

function SignalCard({ s, goCalc }: { s: Signal; goCalc: () => void }) {
  const rr = riskReward(s)
  return (
    <article className={`lite-card srv-signal ${s.side}`}>
      <div className="srv-row">
        <strong className="srv-side">{s.side === 'buy' ? '🟢 MUA' : '🔴 BÁN'} {s.symbol}</strong>
        <small className="muted">{ago(s.time)}</small>
      </div>
      <dl className="srv-levels">
        <div><dt>Giá vào</dt><dd>{s.entry ?? 'Giá hiện tại'}</dd></div>
        <div className="sl"><dt>Cắt lỗ</dt><dd>{s.sl ?? '—'}</dd></div>
        <div className="tp"><dt>Chốt lời</dt><dd>{s.tps.length ? s.tps.join(' · ') : '—'}</dd></div>
      </dl>
      {s.sl == null && <p className="notice bad small">⚠ Tin không có cắt lỗ. Đừng vào khi chưa tự đặt cắt lỗ.</p>}
      <div className="srv-row">
        <small className="muted">{s.channel}{rr != null ? ` · lời/lỗ 1:${rr.toFixed(1)}` : ''}</small>
        <button className="lite-link mini" onClick={goCalc}>Tính lot →</button>
      </div>
    </article>
  )
}
