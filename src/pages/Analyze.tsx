import { useEffect, useState } from 'react'
import { Field } from '../components/Field'
import { bridgeGet, bridgePost, type BridgeState, type Candle } from '../lib/bridge'
import { ANALYSIS_TFS, digitsOf, referenceLevels, tfFeatures, type MarketFeatures } from '../lib/features'
import { calcPosition, normalizeSymbol, PAIRS, parseSymbol, pipSize } from '../lib/forex'
import { money } from '../lib/format'
import { fmtServerTime } from '../lib/parse'
import { BIAS_TEXT, CONFIDENCE_TEXT, ORDER_TEXT, type Analysis, type AnalysisResult, type Playbook } from '../lib/kb'
import { usePersistent } from '../lib/store'
import type { Settings } from '../lib/types'
import { AiSetup } from './Learn'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

/** Lấy nến 4 khung từ MT5 và tính đặc điểm giá cho một cặp. */
export async function buildFeatures(symbol: string, bridge: BridgeState, serverOffset: number): Promise<MarketFeatures> {
  const digits = digitsOf(symbol)
  const candles: Record<string, Candle[]> = {}
  for (const t of ANALYSIS_TFS) candles[t.tf] = await bridgeGet<Candle[]>(`/candles?symbol=${symbol}&tf=${t.tf}&count=${t.count}`)
  const prices = await bridgeGet<Record<string, { bid: number; ask: number }>>(`/prices?symbols=${symbol}`).catch(() => ({} as Record<string, { bid: number; ask: number }>))
  const last = candles.M15[candles.M15.length - 1]
  return {
    symbol,
    server_time: last ? fmtServerTime(last.t * 1000).slice(0, 16) : '',
    pip_size: pipSize(parseSymbol(symbol)!),
    price: prices[symbol] ?? null,
    levels: referenceLevels(candles.D1, candles.M15, serverOffset, digits),
    timeframes: ANALYSIS_TFS.map((t) => tfFeatures(t.tf, candles[t.tf], digits, t.k)),
    open_positions: bridge.accounts.flatMap((a) => a.positions.filter((p) => normalizeSymbol(p.symbol) === symbol).map((p) => ({ side: p.side, volume: p.volume, open: p.openPrice, sl: p.sl, tp: p.tp }))),
  }
}

function TradeBox({ a, symbol, settings }: { a: Analysis; symbol: string; settings: Settings }) {
  const t = a.trade
  if (!a.has_trade || t.side === 'none' || t.entry == null || t.sl == null) {
    return <div className="no-trade"><strong>Chưa có lệnh</strong>{a.wait_for && <div>Cần chờ: {a.wait_for}</div>}</div>
  }
  const info = parseSymbol(symbol)
  const slPips = info ? Math.abs(t.entry - t.sl) / pipSize(info) : 0
  const pos = calcPosition({ symbol, accountCcy: settings.accountCcy, balance: settings.balance, riskPct: settings.riskPct, slPips, leverage: settings.leverage, quotes: settings.quotes, tpPips: t.tp1 != null && info ? Math.abs(t.tp1 - t.entry) / pipSize(info) : undefined })
  const wrong = t.side === 'buy' ? t.sl >= t.entry : t.sl <= t.entry
  return (
    <div className={`trade-box ${t.side}`}>
      <div className="trade-head"><strong>{t.side === 'buy' ? 'BUY' : 'SELL'} {symbol}</strong> <span className="chip">{ORDER_TEXT[t.order_type]}</span> <span className="chip">Độ tin cậy: {CONFIDENCE_TEXT[t.confidence]}</span></div>
      <dl className="trade-grid">
        <dt>Giá vào</dt><dd>{t.entry}</dd>
        <dt>Stop loss</dt><dd>{t.sl} <span className="muted small">({slPips.toFixed(1)} pip)</span></dd>
        {t.tp1 != null && <><dt>TP1</dt><dd>{t.tp1}</dd></>}
        {t.tp2 != null && <><dt>TP2</dt><dd>{t.tp2}</dd></>}
        {t.rr != null && <><dt>R:R</dt><dd>1:{t.rr.toFixed(1)}</dd></>}
        {pos && <><dt>Khối lượng</dt><dd>{pos.lots.toFixed(2)} lot <span className="muted small">rủi ro {money(pos.actualRisk, settings.accountCcy)} ({settings.riskPct}% của {money(settings.balance, settings.accountCcy, 0)})</span></dd></>}
      </dl>
      {t.invalidation && <p className="small">Lệnh mất hiệu lực khi: {t.invalidation}</p>}
      {wrong && <p className="warn">⚠ Stop loss nằm sai phía so với giá vào. Đừng dùng đề xuất này.</p>}
    </div>
  )
}

export default function Analyze({ bridge, settings }: { bridge: BridgeState; settings: Settings }) {
  const [books, setBooks] = useState<Playbook[]>([])
  const [ai, setAi] = useState<{ configured: boolean; model: string } | null>(null)
  const [bookId, setBookId] = usePersistent('fx.ai.playbook', '')
  const [watch, setWatch] = usePersistent<string[]>('fx.watchlist', ['XAUUSD', 'EURUSD', 'GBPUSD'])
  const [results, setResults] = usePersistent<Record<string, AnalysisResult>>('fx.analyses', {})
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState('USDJPY')
  const [progress, setProgress] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const mt5 = bridge.accounts.length > 0

  useEffect(() => {
    if (!bridge.online) return
    bridgeGet<Playbook[]>('/kb').then(setBooks).catch(() => setBooks([]))
    bridgeGet<{ configured: boolean; model: string }>('/ai/status').then(setAi).catch(() => setAi(null))
  }, [bridge.online])
  const book = books.find((b) => b.id === bookId) ?? books.find((b) => b.rules.trim())

  async function analyzeAll(list: string[]) {
    if (!book) return
    setErrors({})
    for (const [i, symbol] of list.entries()) {
      try {
        setProgress(`${symbol} (${i + 1}/${list.length}): đang lấy nến MT5…`)
        const features = await buildFeatures(symbol, bridge, settings.serverOffset)
        setProgress(`${symbol} (${i + 1}/${list.length}): agent đang áp bộ quy tắc "${book.name}"…`)
        const r = await bridgePost<{ analysis: Analysis; model: string; usage: { input: number; output: number } }>('/ai/analyze', { playbook: book.id, features, note })
        setResults((all) => ({ ...all, [symbol]: { symbol, playbook: book.name, at: Date.now(), analysis: r.analysis, model: r.model, features, usage: r.usage } }))
      } catch (e) {
        setErrors((all) => ({ ...all, [symbol]: errText(e) }))
      }
    }
    setProgress('')
  }

  if (!bridge.online) return (<><h1>Phân tích AI</h1><AiSetup online={false} /></>)

  const shown = watch.filter((s) => results[s] || errors[s])
  return (
    <>
      <h1>Phân tích AI</h1>
      {ai && !ai.configured && <AiSetup online />}
      {!mt5 && <p className="warn">⚠ Cần ít nhất một tài khoản MT5 đã nối để lấy nến. Thêm ở trang Tài khoản MT5.</p>}
      {books.length > 0 && !books.some((b) => b.rules.trim()) && <p className="warn">⚠ Các bộ kiến thức chưa có quy tắc. Hãy dạy agent ở trang Học kiến thức trước.</p>}
      {books.length === 0 && <p className="warn">⚠ Chưa có bộ kiến thức nào. Tạo ở trang Học kiến thức.</p>}

      <section className="card">
        <div className="prop-form">
          <Field label="Bộ kiến thức áp dụng">
            <select value={book?.id ?? ''} onChange={(e) => setBookId(e.target.value)}>
              {books.map((b) => <option key={b.id} value={b.id} disabled={!b.rules.trim()}>{b.name}{b.rules.trim() ? '' : ' (chưa có quy tắc)'}</option>)}
            </select>
          </Field>
          <Field label="Ghi chú thêm cho lần này" hint="Không bắt buộc"><input value={note} placeholder="VD: chỉ tìm lệnh phiên Mỹ" onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="field-label" style={{ marginTop: 12 }}>Danh sách theo dõi</div>
        <div className="watch">
          {watch.map((s) => (
            <span key={s} className="chip watch-chip">{s}
              <button className="ghost icon" aria-label={`Bỏ ${s}`} onClick={() => setWatch(watch.filter((x) => x !== s))}>✕</button>
              <button className="ghost mini" disabled={!!progress || !book || !mt5} onClick={() => analyzeAll([s])}>Phân tích</button>
            </span>
          ))}
          <span className="watch-add">
            <select aria-label="Thêm cặp" value={adding} onChange={(e) => setAdding(e.target.value)} style={{ width: 'auto' }}>{PAIRS.filter((p) => !watch.includes(p)).map((p) => <option key={p}>{p}</option>)}</select>
            <button onClick={() => { if (!watch.includes(adding)) setWatch([...watch, adding]) }}>Thêm</button>
          </span>
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!!progress || !book || !mt5 || !watch.length || ai?.configured === false} onClick={() => analyzeAll(watch)}>Phân tích {watch.length} cặp</button>
          {progress && <span className="muted small">{progress}</span>}
        </div>
        <p className="muted small">Agent nhận các đặc điểm giá tính từ nến D1, H4, H1, M15 của MT5 (xu hướng, cấu trúc, BOS/CHoCH, FVG, order block, thanh khoản, đỉnh đáy ngày và tuần trước, biên phiên Á) và chỉ áp dụng bộ quy tắc đã chọn. Mỗi cặp là một lần gọi API.</p>
      </section>

      {shown.length === 0 && <section className="card empty"><p className="muted">Chưa có kết quả. Chọn bộ kiến thức rồi bấm Phân tích.</p></section>}
      <div className="analyses">
        {shown.map((symbol) => {
          const r = results[symbol]
          if (errors[symbol]) return <section key={symbol} className="card"><h3>{symbol}</h3><p className="notice bad">⚠ {errors[symbol]}</p></section>
          const a = r.analysis
          return (
            <section key={symbol} className="card analysis">
              <div className="card-head">
                <h3>{symbol} <span className={`trend ${a.main_trend}`}>{BIAS_TEXT[a.main_trend]}</span></h3>
                <span className="muted small">{new Date(r.at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {r.playbook}</span>
              </div>
              <p>{a.summary}</p>
              <div className="tf-row">
                {a.timeframes.map((t) => <div key={t.tf} className="tf-cell" title={t.note}><span className="muted small">{t.tf}</span><strong className={`trend ${t.bias}`}>{BIAS_TEXT[t.bias]}</strong><span className="small">{t.note}</span></div>)}
              </div>
              <TradeBox a={a} symbol={symbol} settings={settings} />
              <details className="guide" open={!a.has_trade}>
                <summary>Kiểm tra theo bộ quy tắc ({a.checklist.filter((c) => c.met).length}/{a.checklist.length} đạt)</summary>
                <ul className="checklist">
                  {a.checklist.map((c, i) => <li key={i} className={c.met ? 'met' : 'unmet'}><span aria-hidden>{c.met ? '✓' : '✕'}</span><div><strong>{c.rule}</strong><div className="muted small">{c.detail}</div></div></li>)}
                </ul>
              </details>
              {a.key_levels.length > 0 && (
                <details className="guide">
                  <summary>Mức giá quan trọng</summary>
                  <table><tbody>{[...a.key_levels].sort((x, y) => y.price - x.price).map((l, i) => <tr key={i}><td className="num">{l.price}</td><td>{l.label}</td></tr>)}</tbody></table>
                </details>
              )}
              <details className="guide">
                <summary>Dữ liệu đã gửi cho agent</summary>
                <pre className="json">{JSON.stringify(r.features, null, 1)}</pre>
              </details>
            </section>
          )
        })}
      </div>
      <p className="muted small">Đây là phân tích tham khảo theo bộ quy tắc của bạn, không phải khuyến nghị đầu tư. Luôn tự kiểm tra trên biểu đồ trước khi vào lệnh.</p>
    </>
  )
}
