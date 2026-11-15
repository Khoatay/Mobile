import { useEffect, useMemo, useRef, useState } from 'react'
import { Field, Num } from '../components/Field'
import { bridgePost, type BridgeState } from '../lib/bridge'
import { PAIRS } from '../lib/forex'
import { signed } from '../lib/format'
import { fmtServerTime } from '../lib/parse'
import { drawBanner, PERIODS, periodTrades, resultPost, signalPost, statsPost, type Period, type Post, type Profile } from '../lib/share'
import { netOf, type Settings, type Side, type Trade } from '../lib/types'

type Kind = 'signal' | 'result' | 'stats'
interface Props { bridge: BridgeState; trades: Trade[]; settings: Settings; profile: Profile; labels: Record<string, string> }

export default function Share({ bridge, trades, settings, profile, labels }: Props) {
  const [kind, setKind] = useState<Kind>('signal')
  const [symbol, setSymbol] = useState('XAUUSD')
  const [side, setSide] = useState<Side>('buy')
  const [entry, setEntry] = useState(NaN)
  const [sl, setSl] = useState(NaN)
  const [tp1, setTp1] = useState(NaN)
  const [tp2, setTp2] = useState(NaN)
  const [note, setNote] = useState('')
  const [tradeId, setTradeId] = useState('')
  const [period, setPeriod] = useState<Period>('week')
  const [account, setAccount] = useState('')
  const [caption, setCaption] = useState('')
  const [target, setTarget] = useState('')
  const [withImage, setWithImage] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const ccy = settings.accountCcy

  const recent = useMemo(() => [...trades].sort((a, b) => b.closeTime - a.closeTime).slice(0, 40), [trades])
  const accountIds = useMemo(() => [...new Set(trades.map((t) => t.account).filter((a): a is string => !!a))], [trades])
  const targets = bridge.status?.telegram.postTargets ?? []
  const sendTo = target || targets[0] || ''

  const post: Post | null = useMemo(() => {
    if (kind === 'signal') {
      if (![entry, sl].every(Number.isFinite)) return null
      return signalPost({ symbol, side, entry, sl, tps: [tp1, tp2].filter(Number.isFinite), note }, profile)
    }
    if (kind === 'result') {
      const t = recent.find((x) => x.id === tradeId) ?? recent[0]
      return t ? resultPost(t, ccy, profile) : null
    }
    const pool = account ? trades.filter((t) => t.account === account) : trades
    const list = periodTrades(pool, period, Date.now() + settings.serverOffset * 3_600_000)
    return list.length ? statsPost(list, PERIODS[period], ccy, profile) : null
  }, [kind, symbol, side, entry, sl, tp1, tp2, note, tradeId, period, account, trades, recent, profile, ccy, settings.serverOffset])

  // Nội dung bài tự viết lại khi dữ liệu đổi; sau đó người dùng sửa tay được.
  useEffect(() => { setCaption(post?.caption ?? '') }, [post])
  useEffect(() => { if (post && canvas.current) drawBanner(canvas.current, post.spec, profile) }, [post, profile])

  const wrongSide = kind === 'signal' && [entry, sl].every(Number.isFinite) && (side === 'buy' ? sl >= entry : sl <= entry)

  function savePng() {
    const a = document.createElement('a')
    a.href = canvas.current!.toDataURL('image/png')
    a.download = `banner-${kind}.png`
    a.click()
  }

  async function copy() {
    try { await navigator.clipboard.writeText(caption); setMsg({ ok: true, text: 'Đã sao chép nội dung.' }) }
    catch { setMsg({ ok: false, text: 'Trình duyệt không cho sao chép tự động; hãy bôi đen và chép tay.' }) }
  }

  async function send() {
    if (!confirm(`Gửi bài này${withImage ? ' kèm ảnh' : ''} lên nhóm "${sendTo}"?\nMọi thành viên trong nhóm sẽ thấy.`)) return
    setBusy(true)
    try {
      await bridgePost('/telegram/send', { target: sendTo, text: caption, image: withImage ? canvas.current!.toDataURL('image/png') : '' })
      setMsg({ ok: true, text: `Đã gửi lên "${sendTo}".` })
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi không rõ' }) }
    finally { setBusy(false) }
  }

  return (
    <>
      <h1>Chia sẻ cộng đồng</h1>
      <div className="filters">
        <div className="seg">
          {([['signal', 'Tín hiệu'], ['result', 'Kết quả lệnh'], ['stats', 'Thống kê theo kỳ']] as const).map(([k, label]) => (
            <button key={k} className={kind === k ? 'active' : ''} aria-pressed={kind === k} onClick={() => { setKind(k); setMsg(null) }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="share">
        <div>
          <section className="card">
            {kind === 'signal' && (
              <div className="prop-form">
                <Field label="Cặp tiền"><select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{PAIRS.map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field group label="Chiều">
                  <div className="seg">
                    <button className={side === 'buy' ? 'active' : ''} aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>Buy</button>
                    <button className={side === 'sell' ? 'active' : ''} aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>Sell</button>
                  </div>
                </Field>
                <Field label="Giá vào"><Num value={entry} onChange={setEntry} /></Field>
                <Field label="Stop loss"><Num value={sl} onChange={setSl} /></Field>
                <Field label="Take profit 1"><Num value={tp1} onChange={setTp1} /></Field>
                <Field label="Take profit 2"><Num value={tp2} onChange={setTp2} /></Field>
                <Field label="Nhận định kèm theo"><input value={note} placeholder="Lý do vào lệnh, điều kiện huỷ…" onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
            )}
            {kind === 'result' && (recent.length === 0 ? <p className="muted">Nhật ký chưa có lệnh nào.</p> : (
              <Field label="Lệnh đã đóng">
                <select value={tradeId || recent[0].id} onChange={(e) => setTradeId(e.target.value)}>
                  {recent.map((t) => <option key={t.id} value={t.id}>{fmtServerTime(t.closeTime).slice(0, 16)} · {t.symbol} {t.side === 'buy' ? 'Buy' : 'Sell'} {t.volume} · {signed(netOf(t))}{t.account ? ` · ${labels[t.account] ?? t.account}` : ''}</option>)}
                </select>
              </Field>
            ))}
            {kind === 'stats' && (
              <div className="prop-form">
                <Field label="Kỳ"><select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>{Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                {accountIds.length > 0 && (
                  <Field label="Tài khoản"><select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Mọi tài khoản</option>{accountIds.map((a) => <option key={a} value={a}>{labels[a] ?? a}</option>)}</select></Field>
                )}
              </div>
            )}
            {wrongSide && <p className="warn">⚠ Stop loss đang nằm sai phía so với giá vào.</p>}
            {kind === 'signal' && !post && <p className="muted small">Nhập giá vào và stop loss để xem bài.</p>}
            {kind === 'stats' && !post && <p className="muted">Không có lệnh nào đóng trong kỳ này.</p>}
          </section>

          {post && (
            <section className="card">
              <h3>Nội dung bài đăng</h3>
              <textarea rows={11} value={caption} onChange={(e) => setCaption(e.target.value)} />
              <div className="actions" style={{ marginTop: 10 }}>
                <button onClick={savePng}>Tải ảnh PNG</button>
                <button onClick={copy}>Sao chép nội dung</button>
              </div>
              <div className="send-row">
                {targets.length > 0 ? (
                  <>
                    <select aria-label="Nhóm nhận" value={sendTo} onChange={(e) => setTarget(e.target.value)} style={{ width: 'auto' }}>{targets.map((t) => <option key={t}>{t}</option>)}</select>
                    <label className="inline"><input type="checkbox" className="check" checked={withImage} onChange={(e) => setWithImage(e.target.checked)} /> Kèm ảnh</label>
                    <button className="primary" disabled={busy || !caption.trim() || wrongSide} onClick={send}>{busy ? 'Đang gửi…' : 'Gửi lên Telegram'}</button>
                  </>
                ) : (
                  <span className="muted small">Muốn gửi thẳng lên Telegram: thêm tên nhóm vào <code>post_targets</code> trong <code>bridge/config.json</code> rồi chạy lại bridge. Chưa có thì tải ảnh và chép nội dung để đăng tay (Zalo, Facebook, Telegram).</span>
                )}
              </div>
              {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
              <p className="muted small">Bài gửi bằng tài khoản Telegram của bạn và chỉ tới nhóm có trong danh sách cho phép. Tên thương hiệu, link giới thiệu, dòng cảnh báo và việc ẩn số tiền chỉnh ở trang Cá nhân hoá.</p>
            </section>
          )}
        </div>
        <div className="banner-wrap">{post ? <canvas ref={canvas} className="banner" aria-label={`Banner: ${post.spec.kicker}, ${post.spec.title}, ${post.spec.big}`} /> : <div className="banner empty-banner">Banner sẽ hiện ở đây</div>}</div>
      </div>
    </>
  )
}
