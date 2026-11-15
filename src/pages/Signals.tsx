import { useEffect, useMemo, useRef, useState } from 'react'
import { bridgeGet, type BridgeState, type Candle, type TgMessage } from '../lib/bridge'
import { pct, signed } from '../lib/format'
import {
  channelStats, confluence, demoMessages, evaluateSignal, parseSignal, riskReward, trendOf, VERDICT_TEXT,
  type Outcome, type Signal, type Trend, type Verdict,
} from '../lib/signals'
import type { Settings } from '../lib/types'

const WINDOWS = [4, 12, 24, 72]
const ICON: Record<Verdict, string> = { strong: '✓✓', agree: '✓', counter: '⚠', conflict: '⛔', single: '○' }
const ADVICE: Record<Verdict, string> = {
  strong: 'Đáng xem xét, nếu cũng khớp phân tích của chính bạn',
  agree: 'Có thể xem xét; chưa có xác nhận từ xu hướng',
  counter: 'Thận trọng: các kênh đang đi ngược xu hướng H4',
  conflict: 'Nên đứng ngoài: các kênh mâu thuẫn nhau',
  single: 'Chưa đủ cơ sở: mới có một kênh',
}
const TREND: Record<Trend, string> = { up: '↑ Tăng', down: '↓ Giảm', flat: '→ Đi ngang' }
const fmtTime = (ms: number) => new Date(ms).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Signals({ bridge, settings }: { bridge: BridgeState; settings: Settings }) {
  const [messages, setMessages] = useState<TgMessage[]>([])
  const [demo, setDemo] = useState(false)
  const [hours, setHours] = useState(24)
  const [trends, setTrends] = useState<Record<string, Trend | null>>({})
  const [outcomes, setOutcomes] = useState<Map<string, { outcome: Outcome; r: number }>>(new Map())
  const [scoring, setScoring] = useState('')
  const [now, setNow] = useState(Date.now())
  const lastDate = useRef(0)
  const tgOn = !!bridge.status?.telegram.connected
  const mt5On = bridge.accounts.length > 0

  // Kéo tin mới mỗi 5 giây; chỉ hỏi những tin sau tin cuối đã có.
  useEffect(() => {
    if (!tgOn || demo) return
    let stop = false
    const pull = async () => {
      try {
        const fresh = await bridgeGet<TgMessage[]>(`/telegram/messages?after=${lastDate.current}`)
        if (stop || !fresh.length) return
        lastDate.current = Math.max(...fresh.map((m) => m.date))
        setMessages((old) => {
          const seen = new Set(old.map((m) => m.channel + ':' + m.id))
          return [...old, ...fresh.filter((m) => !seen.has(m.channel + ':' + m.id))]
        })
      } catch { /* bridge tạm mất, lần sau thử lại */ }
      setNow(Date.now())
    }
    pull()
    const id = setInterval(pull, 5000)
    return () => { stop = true; clearInterval(id) }
  }, [tgOn, demo])

  const signals = useMemo(() => messages.map(parseSignal).filter((s): s is Signal => s !== null).sort((a, b) => b.time - a.time), [messages])
  const active = useMemo(() => signals.filter((s) => now - s.time <= hours * 3_600_000), [signals, now, hours])
  const symbolsKey = [...new Set(active.map((s) => s.symbol))].sort().join(',')

  // Xu hướng H4 cho các cặp đang có tín hiệu, lấy nến từ MT5.
  useEffect(() => {
    if (!mt5On || !symbolsKey) return
    let stop = false
    ;(async () => {
      const next: Record<string, Trend | null> = {}
      for (const sym of symbolsKey.split(',')) {
        try { next[sym] = trendOf(await bridgeGet<Candle[]>(`/candles?symbol=${sym}&tf=H4&count=300`)) }
        catch { next[sym] = null }
      }
      if (!stop) setTrends(next)
    })()
    return () => { stop = true }
  }, [mt5On, symbolsKey])

  async function scoreChannels() {
    const next = new Map<string, { outcome: Outcome; r: number }>()
    const symbols = [...new Set(signals.map((s) => s.symbol))]
    for (const [i, sym] of symbols.entries()) {
      setScoring(`Đang chấm ${sym} (${i + 1}/${symbols.length})…`)
      try {
        const candles = await bridgeGet<Candle[]>(`/candles?symbol=${sym}&tf=M15&count=10000`)
        for (const s of signals.filter((x) => x.symbol === sym)) next.set(s.id, evaluateSignal(s, candles, settings.serverOffset))
      } catch { /* broker không có mã này: bỏ qua */ }
    }
    setOutcomes(next)
    setScoring('')
  }

  const rows = useMemo(() => confluence(signals, now, hours, trends), [signals, now, hours, trends])
  const stats = useMemo(() => channelStats(signals, outcomes), [signals, outcomes])
  const scored = outcomes.size > 0

  return (
    <>
      <h1>Tín hiệu Telegram</h1>
      {demo ? (
        <p className="notice">Đang xem tin mẫu. <button className="ghost" onClick={() => { setDemo(false); setMessages([]); lastDate.current = 0 }}>Thoát tin mẫu</button></p>
      ) : tgOn ? (
        <p className="notice">✓ Đang nghe {bridge.status!.telegram.channels.length} kênh: {bridge.status!.telegram.channels.join(', ')}</p>
      ) : (
        <section className="card">
          <h3>Chưa kết nối Telegram</h3>
          <p className="muted">{bridge.online ? bridge.status?.telegram.error : 'Chương trình nền (bridge) chưa chạy. Xem hướng dẫn ở trang Tài khoản MT5.'}</p>
          <ol className="steps">
            <li>Lấy <code>api_id</code> và <code>api_hash</code> tại my.telegram.org (mục API development tools), điền vào <code>bridge/config.json</code>.</li>
            <li>Chạy <code>python bridge.py login</code>, nhập số điện thoại và mã xác nhận. Lệnh này in ra danh sách kênh bạn đang tham gia.</li>
            <li>Chép tên các kênh muốn theo dõi vào <code>channels</code>, rồi chạy lại <code>python bridge.py</code>.</li>
          </ol>
          <button onClick={() => { setDemo(true); setNow(Date.now()); setMessages(demoMessages(Date.now())) }}>Xem thử với tin mẫu</button>
        </section>
      )}

      <div className="filters">
        <div className="seg">
          {WINDOWS.map((h) => <button key={h} className={hours === h ? 'active' : ''} aria-pressed={hours === h} onClick={() => setHours(h)}>{h} giờ qua</button>)}
        </div>
        <span className="muted small">{messages.length} tin · đọc được {signals.length} lệnh · {active.length} lệnh trong khung này</span>
      </div>

      <section className="card">
        <h3>Độ trùng khớp theo cặp tiền</h3>
        {rows.length === 0 ? <p className="muted">Không có lệnh nào trong khung thời gian này.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Cặp</th><th>Chiều</th><th>Nhận định</th><th>Xu hướng H4</th><th>Các kênh</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol}>
                    <td className="top strong">{r.symbol}</td>
                    <td className="top">{r.verdict === 'conflict' ? 'Buy / Sell' : r.side === 'buy' ? 'Buy' : 'Sell'}</td>
                    <td className="top">
                      <div className="verdict">{ICON[r.verdict]} {VERDICT_TEXT[r.verdict]}</div>
                      <div className="muted small">{ADVICE[r.verdict]}</div>
                      <div className="muted small">{r.reasons.join(' · ')}</div>
                    </td>
                    <td className="top">{r.trend ? TREND[r.trend] : <span className="muted">{mt5On ? 'Thiếu dữ liệu' : 'Cần MT5'}</span>}</td>
                    <td className="top">
                      {[...r.agree, ...r.against].map((s) => {
                        const st = stats.find((x) => x.channel === s.channel)
                        return (
                          <span key={s.id} className={r.against.includes(s) ? 'chip against' : 'chip'} title={s.text}>
                            {s.channel}: {s.side === 'buy' ? 'Buy' : 'Sell'}{s.entry != null && ` ${s.entry}`}{s.sl != null && ` · SL ${s.sl}`}{s.tps.length > 0 && ` · TP ${s.tps[0]}`}
                            {st?.winRate != null && ` · thắng ${pct(st.winRate, 0)}`}
                          </span>
                        )
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Nhiều kênh cùng chiều chưa phải bằng chứng độc lập, vì các kênh thường sao chép nhau. Đây là công cụ sàng lọc, không phải khuyến nghị đầu tư.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Thành tích từng kênh</h3>
          <div className="actions">
            {scoring && <span className="muted small">{scoring}</span>}
            <button disabled={!mt5On || !!scoring || !signals.length} onClick={scoreChannels}>Chấm lại bằng dữ liệu giá MT5</button>
          </div>
        </div>
        {!mt5On && <p className="muted small">Cần kết nối MT5 để lấy nến và kiểm tra từng lệnh chạm TP hay SL trước.</p>}
        {stats.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Kênh</th><th className="num">Lệnh đọc được</th><th className="num">Thắng</th><th className="num">Thua</th><th className="num">Đang chạy</th><th className="num">Tỷ lệ thắng</th><th className="num">Tổng R</th></tr></thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.channel}>
                    <td>{s.channel}</td><td className="num">{s.signals}</td>
                    <td className="num">{scored ? s.wins : '–'}</td><td className="num">{scored ? s.losses : '–'}</td><td className="num">{scored ? s.open : '–'}</td>
                    <td className="num">{s.winRate == null ? '–' : pct(s.winRate, 0)}</td>
                    <td className="num strong">{scored ? signed(s.totalR, 1) + 'R' : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Cách chấm: vào tại giá kênh đăng (hoặc giá mở nến M15 kế tiếp nếu không ghi giá), thắng nếu chạm TP1 trước SL. Một nến chạm cả hai tính là thua. Chưa tính spread, và chỉ chấm được trong phạm vi nến M15 mà broker còn lưu.</p>
      </section>

      <section className="card">
        <h3>Lệnh đọc được gần đây</h3>
        {signals.length === 0 ? <p className="muted">Chưa có.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Lúc</th><th>Kênh</th><th>Cặp</th><th>Chiều</th><th className="num">Giá vào</th><th className="num">SL</th><th className="num">TP</th><th className="num">R:R</th><th>Kết quả</th><th>Tin gốc</th></tr></thead>
              <tbody>
                {signals.slice(0, 60).map((s) => {
                  const rr = riskReward(s)
                  const o = outcomes.get(s.id)?.outcome
                  return (
                    <tr key={s.id}>
                      <td className="top nowrap">{fmtTime(s.time)}</td><td className="top">{s.channel}</td><td className="top">{s.symbol}</td>
                      <td className="top">{s.side === 'buy' ? 'Buy' : 'Sell'}</td>
                      <td className="top num">{s.entry ?? '–'}</td><td className="top num">{s.sl ?? '–'}</td><td className="top num">{s.tps.join(' / ') || '–'}</td>
                      <td className="top num">{rr == null ? '–' : `1:${rr.toFixed(1)}`}</td>
                      <td className="top nowrap">{o === 'tp' ? '✓ TP' : o === 'sl' ? '✕ SL' : o === 'open' ? 'Đang chạy' : o === 'unfilled' ? 'Không khớp' : '–'}</td>
                      <td className="top"><div className="msg">{s.text}</div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
