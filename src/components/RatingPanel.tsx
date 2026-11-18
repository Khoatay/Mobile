import { useEffect, useMemo, useRef, useState } from 'react'
import EquityChart from './EquityChart'
import { gradeOf, loadRating, ratePayload, saveRating, signature, type AiRating, type AiScore, type RateAccount, type StoredRating } from '../lib/aiRate'
import { bridgeGet, bridgePost } from '../lib/bridge'
import { money, signed } from '../lib/format'
import { fmtServerTime } from '../lib/parse'
import { computeStats } from '../lib/stats'
import { assess, type Score, type Verdict } from '../lib/traderScore'
import { netOf, type Trade } from '../lib/types'

/** "Tất cả": 10 năm, như nút Toàn bộ khi đồng bộ Nhật ký. */
export const ALL = 3650
export const PERIODS = [30, 90, 180, 365, ALL]
export const periodText = (d: number) => (d === ALL ? 'Tất cả' : d === 365 ? '1 năm' : d === 180 ? '6 tháng' : `${d} ngày`)

const GRADE_TONE = { good: 'pos', ok: 'ok', weak: 'warn', bad: 'neg' } as const
const CONF_TEXT = { low: 'thấp', medium: 'trung bình', high: 'cao' }
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

/** Tài khoản của chính người dùng: kết luận theo quy tắc nói về việc tự cải thiện, không phải "có nên theo". */
const SELF_VERDICT: Record<Verdict['level'], Pick<Verdict, 'title' | 'detail'>> = {
  consider: { title: 'Đang giao dịch tốt', detail: 'An toàn, có lãi, kỷ luật và ít FOMO. Giữ nguyên cách làm và mức rủi ro hiện tại.' },
  watch: { title: 'Cần cải thiện', detail: 'Có mặt chưa ổn. Xem các điểm thấp bên dưới và sửa từng điều một.' },
  avoid: { title: 'Rủi ro cao, nên điều chỉnh ngay', detail: 'Cách giao dịch hiện tại có thể làm mất phần lớn tài khoản. Giảm khối lượng, luôn đặt stop loss, và cân nhắc nghỉ vài ngày.' },
  unknown: { title: 'Chưa đủ dữ liệu', detail: 'Cần ít nhất 10 lệnh đã đóng trong khoảng thời gian này.' },
}

function ScoreCard({ title, hint, s }: { title: string; hint: string; s: Score }) {
  return (
    <div className={`score-card ${GRADE_TONE[s.grade]}`}>
      <div className="score-head">
        <span className="muted small">{title}</span>
        <strong>{s.score}<small>/100</small></strong>
      </div>
      <div className="score-bar" role="img" aria-label={`${title}: ${s.score} trên 100`}><i style={{ width: `${s.score}%` }} /></div>
      <div className="score-label">{s.label}</div>
      <ul>{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <p className="muted small">{hint}</p>
    </div>
  )
}

interface Props {
  /** Khoá lưu kết quả AI (tài khoản, nhóm…). */
  cacheKey: string
  title: string
  /** null = đang tải. */
  trades: Trade[] | null
  err?: string
  account: RateAccount
  serverOffset: number
  days: number
  setDays: (d: number) => void
  /** follow: tài khoản người khác ("có đáng theo không?"); self: tài khoản của bạn ("nhận xét chung"). */
  perspective: 'follow' | 'self'
  /** Câu nói dữ liệu lấy từ đâu, ở cuối khung. */
  source: string
}

/**
 * Khung đánh giá tài khoản: chỉ số do app tính, bốn điểm và kết luận do AI chấm (hoặc theo quy tắc khi không có AI).
 * Dùng cho tài khoản Only view (trang Tài khoản) và cho từng tài khoản hay nhóm của bạn (trang Nhật ký).
 */
export default function RatingPanel({ cacheKey, title, trades, err, account, serverOffset, days, setDays, perspective, source }: Props) {
  const ccy = account.currency
  const a = useMemo(() => (trades ? assess(trades, account.balance, account.balance > 0 ? (account.equity - account.balance) / account.balance : 0, account.positions.filter((p) => !p.sl).length) : null),
    // Số dư và lệnh mở đổi liên tục; chỉ chấm lại khi danh sách lệnh đổi để điểm không nhảy theo từng tick.
    [trades])
  const s = useMemo(() => (trades ? computeStats(trades, serverOffset) : null), [trades, serverOffset])

  // ---- Chấm điểm bằng AI. Kết quả lưu theo khoá + khoảng thời gian; chỉ gọi lại khi có lệnh mới hoặc người dùng bấm.
  const [ai, setAi] = useState<{ configured: boolean; model: string } | null>(null)
  const [rated, setRated] = useState<StoredRating | null>(null)
  const [rating, setRating] = useState(false)
  const [aiErr, setAiErr] = useState('')
  useEffect(() => { bridgeGet<{ configured: boolean; model: string }>('/ai/status').then(setAi).catch(() => setAi({ configured: false, model: '' })) }, [])
  const sig = trades ? `${perspective}:${signature(trades, days)}` : ''
  const current = useRef('')
  current.current = `${cacheKey}:${sig}`
  const rate = async () => {
    if (!trades || !a) return
    setRating(true); setAiErr('')
    try {
      const r = await bridgePost<{ rating: AiRating; model: string }>('/ai/rate', ratePayload(trades, account, a.metrics, days, perspective))
      const stored = { rating: r.rating, signature: sig, at: Date.now(), model: r.model }
      saveRating(cacheKey, days, stored)
      // Người dùng đã đổi tài khoản hoặc khoảng thời gian trong lúc chờ: chỉ lưu, không hiện nhầm.
      if (current.current === `${cacheKey}:${sig}`) setRated(stored)
    } catch (e) { setAiErr(errText(e)) }
    finally { setRating(false) }
  }
  useEffect(() => {
    if (!trades || !a || !ai) return
    const saved = loadRating(cacheKey, days)
    if (saved && saved.signature === sig) { setRated(saved); return }
    setRated(null)
    // Đủ lệnh và có khoá AI thì tự chấm; dưới 10 lệnh thì không gọi AI cho tốn phí.
    if (ai.configured && a.metrics.n >= 10) rate()
  }, [sig, cacheKey, ai?.configured])

  const toScore = (x: AiScore): Score => ({ score: x.score, grade: gradeOf(x.score), label: x.label, reasons: x.reasons })
  const r = rated?.rating
  const ruleVerdict = a && perspective === 'self' ? { level: a.verdict.level, ...SELF_VERDICT[a.verdict.level] } : a?.verdict
  const shown = r
    ? { safety: toScore(r.safety), growth: toScore(r.growth), discipline: toScore(r.discipline), fomo: toScore(r.fomo), verdict: r.verdict, confidence: r.confidence }
    : a && ruleVerdict ? { ...a, verdict: ruleVerdict } : null
  const recent = useMemo(() => (trades ? [...trades].sort((x, y) => y.closeTime - x.closeTime).slice(0, 8) : []), [trades])
  const m = a?.metrics
  const pc = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <div className="seg">
          {PERIODS.map((d) => <button key={d} className={days === d ? 'active' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>{periodText(d)}</button>)}
        </div>
      </div>
      {err && <p className="notice bad">⚠ {err}</p>}
      {!a && !err && <p className="muted">Đang đọc lịch sử…</p>}
      {a && m && shown && (
        <>
          <div className="ai-source">
            {rating ? <span><span className="spinner" aria-hidden="true" /> AI đang đọc {m.n} lệnh và chấm điểm…</span>
              : r ? <span>✦ Chấm bởi AI ({rated!.model}) lúc {new Date(rated!.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
              : <span className="muted">{!ai ? 'Đang kiểm tra AI…' : !ai.configured ? 'Chưa có khoá AI trong bridge: đang hiện điểm chấm theo quy tắc.' : m.n < 10 ? 'Dưới 10 lệnh: chưa gọi AI, đang hiện điểm chấm theo quy tắc.' : 'Đang hiện điểm chấm theo quy tắc.'}</span>}
            {ai?.configured && m.n >= 10 && !rating && <button className="ghost mini" onClick={rate}>{r ? 'Chấm lại' : 'Chấm bằng AI'}</button>}
          </div>
          {aiErr && <p className="notice bad">⚠ AI chưa chấm được: {aiErr} Đang hiện điểm chấm theo quy tắc.</p>}
          <div className={`verdict ${shown.verdict.level}${rating ? ' dim' : ''}`}>
            <div>
              <span className="muted small">{perspective === 'self' ? 'Nhận xét chung' : 'Có đáng theo không?'}</span>
              <strong>{shown.verdict.title}</strong>
              <p>{shown.verdict.detail}</p>
            </div>
            <span className="chip">Độ tin cậy {CONF_TEXT[shown.confidence]} · {m.n} lệnh / {Math.max(1, Math.round(m.spanDays))} ngày</span>
          </div>
          {r && (r.strengths.length > 0 || r.red_flags.length > 0) && (
            <div className="flags">
              {r.red_flags.length > 0 && <div className="flag-col bad"><strong>{perspective === 'self' ? 'Cần sửa' : 'Cảnh báo'}</strong><ul>{r.red_flags.map((x) => <li key={x}>{x}</li>)}</ul></div>}
              {r.strengths.length > 0 && <div className="flag-col good"><strong>Điểm mạnh</strong><ul>{r.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            </div>
          )}

          {m.n > 0 && (
            <>
              <div className={rating ? 'score-grid dim' : 'score-grid'}>
                <ScoreCard title="An toàn" hint="Sụt giảm, lệnh thua lớn nhất, stop loss, gấp thếp." s={shown.safety} />
                <ScoreCard title="Tăng trưởng" hint="Lãi theo % vốn, profit factor, số tuần có lãi." s={shown.growth} />
                <ScoreCard title="Kỷ luật" hint="Đặt SL, cắt lỗ đúng kế hoạch, lot đều tay." s={shown.discipline} />
                <ScoreCard title="Kiểm soát FOMO" hint="Điểm cao là ít FOMO: ít lệnh gỡ, không vào dồn dập." s={shown.fomo} />
              </div>

              <div className="metric-grid">
                <div><span>Tỷ lệ thắng</span><strong>{Math.round(m.winRate * 100)}%</strong><small>{m.wins} thắng · {m.losses} thua</small></div>
                <div><span>Lãi/lỗ ròng</span><strong className={m.net > 0 ? 'pos' : m.net < 0 ? 'neg' : ''}>{signed(m.net)} {ccy}</strong><small>{pc(m.growthPct)} so với vốn</small></div>
                <div><span>Lãi trung bình / lệnh thắng</span><strong className="pos">{money(m.avgWin, ccy)}</strong><small>Lỗ trung bình / lệnh thua: <b className="neg">{money(m.avgLoss, ccy)}</b></small></div>
                <div><span>Lệnh lãi lớn nhất</span><strong className="pos">{money(m.bestWin, ccy)}</strong><small>Nhỏ nhất: {money(m.smallestWin, ccy)}</small></div>
                <div><span>Lệnh lỗ lớn nhất</span><strong className="neg">{money(m.worstLoss, ccy)}</strong><small>{(m.worstLossPct * 100).toFixed(1)}% vốn · nhỏ nhất: {money(m.smallestLoss, ccy)}</small></div>
                <div><span>Profit factor</span><strong>{Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}</strong><small>Kỳ vọng {signed(m.expectancy)} {ccy} / lệnh</small></div>
                <div><span>Sụt giảm lớn nhất</span><strong className="neg">{(m.maxDrawdownPct * 100).toFixed(1)}%</strong><small>{money(m.maxDrawdown, ccy)} · chuỗi thua dài nhất {m.maxLosingStreak}</small></div>
                <div><span>Lệnh có stop loss</span><strong>{Math.round(m.slShare * 100)}%</strong><small>{m.tradesPerDay.toFixed(1)} lệnh mỗi ngày giao dịch</small></div>
              </div>

              {s && <EquityChart points={s.equity} ccy={ccy} />}
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Đóng lúc</th><th>Cặp</th><th>Chiều</th><th className="num">Lot</th><th className="num">Lãi/lỗ</th></tr></thead>
                  <tbody>{recent.map((t) => { const n = netOf(t); return <tr key={t.id}><td className="nowrap">{fmtServerTime(t.closeTime).slice(0, 16)}</td><td>{t.symbol}</td><td>{t.side === 'buy' ? 'Buy' : 'Sell'}</td><td className="num">{t.volume.toFixed(2)}</td><td className="num strong"><span className={n > 0 ? 'pip pos' : n < 0 ? 'pip neg' : 'pip'} />{signed(n)}</td></tr> })}</tbody>
                </table>
              </div>
            </>
          )}
          <p className="muted small">{r ? 'Điểm và kết luận do AI chấm từ các con số trên và danh sách lệnh; các con số do app tự tính nên luôn chính xác. AI có thể nhận định sai: đọc kỹ lý do trước khi quyết định.' : 'Đánh giá tự động theo quy tắc cố định.'} Dựa trên {days === ALL ? 'toàn bộ lịch sử' : `lịch sử ${periodText(days)} gần nhất`} {source}. Vốn tính bằng số dư hiện tại trừ lãi/lỗ trong kỳ (đã gồm tiền nạp và rút). Kết quả quá khứ không bảo đảm kết quả sau này; đây không phải lời khuyên đầu tư.</p>
        </>
      )}
    </section>
  )
}
