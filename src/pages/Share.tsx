import { useEffect, useMemo, useRef, useState } from 'react'
import { ask } from '../lib/ask'
import { Field, Num } from '../components/Field'
import ScopeSelect from '../components/ScopeSelect'
import { inScope, scopeLabel, type InfoMap } from '../lib/accounts'
import { bridgePost, type BridgeState } from '../lib/bridge'
import { PAIRS } from '../lib/forex'
import { signed } from '../lib/format'
import { fmtServerTime } from '../lib/parse'
import { drawBanner, PERIODS, periodTrades, resultPost, signalPost, statsPost, type Period, type Post, type Profile } from '../lib/share'
import { loadImage } from '../lib/images'
import { parseSignal, type Signal } from '../lib/signals'
import type { TgMessage } from '../lib/bridge'
import type { UserProfile } from '../lib/user'
import { netOf, type Settings, type Side, type Trade } from '../lib/types'

type Kind = 'signal' | 'result' | 'stats'
interface Props { bridge: BridgeState; trades: Trade[]; settings: Settings; profile: Profile; labels: Record<string, string>; infos: InfoMap; user: UserProfile; messages: TgMessage[]; isPro: boolean; proUrl: string }

export default function Share({ bridge, trades, settings, profile, labels, infos, user, messages, isPro, proUrl }: Props) {
  const [source, setSource] = useState<'own' | 'telegram'>('own')
  const [credit, setCredit] = useState(true)
  const [picked, setPicked] = useState('')
  const [avatarImg, setAvatarImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => { loadImage(user.avatar).then(setAvatarImg) }, [user.avatar])
  // Tín hiệu đọc được từ các kênh Telegram đang theo dõi, mới nhất trước.
  const tgSignals = useMemo(() => messages.map(parseSignal).filter((x): x is Signal => !!x && x.entry != null && x.sl != null).sort((a, b) => b.time - a.time).slice(0, 40), [messages])
  function applySignal(id: string) {
    const sg = tgSignals.find((x) => x.id === id)
    setPicked(id)
    if (!sg) return
    setSymbol(sg.symbol); setSide(sg.side); setEntry(sg.entry ?? NaN); setSl(sg.sl ?? NaN)
    setTp1(sg.tps[0] ?? NaN); setTp2(sg.tps[1] ?? NaN)
  }
  const pickedSignal = tgSignals.find((x) => x.id === picked)
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
  const [scope, setScope] = useState('')
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
      const src = source === 'telegram' && credit && pickedSignal ? `Nguồn tham khảo: ${pickedSignal.channel}` : ''
      return signalPost({ symbol, side, entry, sl, tps: [tp1, tp2].filter(Number.isFinite), note: [note, src].filter(Boolean).join('\n') }, profile)
    }
    if (kind === 'result') {
      const t = recent.find((x) => x.id === tradeId) ?? recent[0]
      return t ? resultPost(t, ccy, profile) : null
    }
    const pool = trades.filter((t) => inScope(scope, t.account, infos))
    const list = periodTrades(pool, period, Date.now() + settings.serverOffset * 3_600_000)
    return list.length ? statsPost(list, scope ? `${PERIODS[period]} · ${scopeLabel(scope, infos)}` : PERIODS[period], ccy, profile) : null
  }, [kind, symbol, side, entry, sl, tp1, tp2, note, tradeId, period, scope, infos, trades, recent, profile, ccy, settings.serverOffset, source, credit, pickedSignal])

  // Nội dung bài tự viết lại khi dữ liệu đổi; sau đó người dùng sửa tay được.
  useEffect(() => { setCaption(post?.caption ?? '') }, [post])
  // Ảnh kết quả lệnh và thống kê có ảnh đại diện, tên của người đăng.
  const author = kind !== 'signal' && (user.displayName || user.avatar) ? { name: user.displayName || user.username, handle: user.username ? `@${user.username}` : undefined, image: avatarImg } : undefined
  useEffect(() => { if (post && canvas.current) drawBanner(canvas.current, post.spec, profile, author) }, [post, profile, avatarImg, user.displayName, user.username, kind])

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
    if (!(await ask(`Gửi bài này${withImage ? ' kèm ảnh' : ''} lên nhóm "${sendTo}"?\nMọi thành viên trong nhóm sẽ thấy.`, 'Gửi bài'))) return
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
              <div className="source-row">
                <div className="seg">
                  <button className={source === 'own' ? 'active' : ''} aria-pressed={source === 'own'} onClick={() => setSource('own')}>Tự viết</button>
                  <button className={source === 'telegram' ? 'active' : ''} aria-pressed={source === 'telegram'} onClick={() => setSource('telegram')}>Chép từ kênh Telegram <span className="chip pro">Pro</span></button>
                </div>
              </div>
            )}
            {kind === 'signal' && source === 'telegram' && (!isPro ? (
              <div className="pro-lock">
                <strong>Tính năng Pro</strong>
                <p className="muted small">Chọn một tín hiệu từ các kênh Telegram bạn theo dõi, app điền sẵn cặp, chiều, giá vào, SL, TP để bạn chỉnh và đăng lại.</p>
                {proUrl ? <a className="button primary" href={proUrl} target="_blank" rel="noopener noreferrer">Nâng cấp Pro</a> : <span className="muted small">Liên hệ quản trị cộng đồng để nâng cấp.</span>}
              </div>
            ) : (
              <div className="tg-pick">
                {tgSignals.length === 0 ? <p className="muted small">Chưa đọc được tín hiệu nào từ kênh Telegram. Kết nối Telegram ở bridge và chọn kênh ở <code>channels</code>.</p> : (
                  <Field label="Tín hiệu từ kênh">
                    <select value={picked} onChange={(e) => applySignal(e.target.value)}>
                      <option value="">Chọn tín hiệu…</option>
                      {tgSignals.map((x) => <option key={x.id} value={x.id}>{new Date(x.time).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {x.channel} · {x.symbol} {x.side === 'buy' ? 'Buy' : 'Sell'} {x.entry}</option>)}
                    </select>
                  </Field>
                )}
                <label className="inline wrap"><input type="checkbox" className="check" checked={credit} onChange={(e) => setCredit(e.target.checked)} /> Ghi tên kênh nguồn vào bài đăng</label>
                {pickedSignal && <div className="msg wide tg-quote">{pickedSignal.text}</div>}
              </div>
            ))}
            {kind === 'signal' && (source === 'own' || isPro) && (
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
                {accountIds.length > 0 && <Field label="Tài khoản"><ScopeSelect value={scope} onChange={setScope} infos={infos} ids={accountIds} /></Field>}
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
