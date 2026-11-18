import { useState } from 'react'
import { Field, Num, Tile } from '../components/Field'
import { calcPosition, CURRENCIES, PAIRS, parseSymbol, pipSize, QUOTE_KEYS, SAMPLE_QUOTES } from '../lib/forex'
import { fromOf, FROM_TEXT, neededQuotes, type AutoQuotes } from '../lib/quotes'
import { money } from '../lib/format'
import type { Settings } from '../lib/types'

interface Props { settings: Settings; patch: (p: Partial<Settings>) => void; auto: AutoQuotes }

export default function Calculator({ settings, patch, auto }: Props) {
  const [symbol, setSymbol] = useState('EURUSD')
  const [mode, setMode] = useState<'pips' | 'price'>('pips')
  const [slPips, setSlPips] = useState(20)
  const [tpPips, setTpPips] = useState(40)
  const [entry, setEntry] = useState(NaN)
  const [slPrice, setSlPrice] = useState(NaN)
  const [tpPrice, setTpPrice] = useState(NaN)
  const [allQuotes, setAllQuotes] = useState(false)

  const info = parseSymbol(symbol)!
  const pip = pipSize(info)
  const sl = mode === 'pips' ? slPips : Math.abs(entry - slPrice) / pip
  const tp = mode === 'pips' ? tpPips : Math.abs(tpPrice - entry) / pip
  const ccy = settings.accountCcy
  // Giá vàng làm ví dụ cho phần giải thích pip (lấy theo tỷ giá đang dùng).
  const gold = Math.round(settings.quotes.XAUUSD || 2600)
  const r = calcPosition({
    symbol, accountCcy: ccy, balance: settings.balance, riskPct: settings.riskPct,
    slPips: sl, tpPips: Number.isFinite(tp) ? tp : undefined, leverage: settings.leverage, quotes: settings.quotes,
  })
  const wrongSide = mode === 'price' && [entry, slPrice, tpPrice].every(Number.isFinite) && (tpPrice - entry) * (slPrice - entry) > 0

  // Chỉ những giá cặp này thực sự cần; giá mẫu ảnh hưởng số lot thì mới cảnh báo.
  const needed = neededQuotes(symbol, ccy)
  const sampleLot = needed.filter((q) => q.role === 'lot' && fromOf(settings, q.key) === 'sample')
  const sampleMargin = needed.some((q) => q.role === 'margin' && fromOf(settings, q.key) === 'sample')
  const setQuote = (k: string, v: number) => patch({ quotes: { ...settings.quotes, [k]: v }, quoteFrom: { ...settings.quoteFrom, [k]: 'manual' }, quotesUpdatedAt: Date.now() })
  const quoteInput = (k: string) => (
    <Field key={k} label={k} hint={FROM_TEXT[fromOf(settings, k)]}>
      <Num value={settings.quotes[k]} onChange={(v) => setQuote(k, v)} min={0} />
    </Field>
  )
  const updated = settings.quotesUpdatedAt ? new Date(settings.quotesUpdatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <>
      <h1>Tính khối lượng lệnh</h1>
      <div className="grid-2">
        <section className="card form">
          <Field label="Cặp tiền">
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {PAIRS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <div className="row">
            <Field label="Số dư"><Num value={settings.balance} onChange={(v) => patch({ balance: v })} min={0} /></Field>
            <Field label="Tiền tài khoản">
              <select value={ccy} onChange={(e) => patch({ accountCcy: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Rủi ro mỗi lệnh (%)" tone="risk"><Num value={settings.riskPct} onChange={(v) => patch({ riskPct: v })} step={0.1} min={0} /></Field>
            <Field label="Đòn bẩy (1:x)"><Num value={settings.leverage} onChange={(v) => patch({ leverage: v })} min={1} /></Field>
          </div>
          <div className="seg" role="tablist" aria-label="Cách nhập stop loss">
            <button role="tab" aria-selected={mode === 'pips'} className={mode === 'pips' ? 'active' : ''} onClick={() => setMode('pips')}>Nhập theo pip</button>
            <button role="tab" aria-selected={mode === 'price'} className={mode === 'price' ? 'active' : ''} onClick={() => setMode('price')}>Nhập theo giá</button>
          </div>
          {mode === 'pips' ? (
            <div className="row">
              <Field label="Stop loss (pip)" tone="sl"><Num value={slPips} onChange={setSlPips} min={0} /></Field>
              <Field label="Take profit (pip)" hint="Không bắt buộc" tone="tp"><Num value={tpPips} onChange={setTpPips} min={0} /></Field>
            </div>
          ) : (
            <div className="row">
              <Field label="Giá vào"><Num value={entry} onChange={setEntry} /></Field>
              <Field label="Giá stop loss" tone="sl"><Num value={slPrice} onChange={setSlPrice} /></Field>
              <Field label="Giá take profit" hint="Không bắt buộc" tone="tp"><Num value={tpPrice} onChange={setTpPrice} /></Field>
            </div>
          )}
          {info.base === 'XAU' ? (
            <div className="gold-note">
              <p><strong>Vàng: 10 pip = 1 giá.</strong> Ví dụ giá đi từ {gold.toFixed(1)} lên {(gold + 1).toFixed(1)} là 10 pip; stop loss 50 pip nghĩa là cách giá vào 5 giá. 1 lot = 100 oz, tức 10 USD mỗi pip, 100 USD mỗi 1 giá.</p>
              <p className="warn">⚠ Giá vàng chạy rất nhanh, có lúc đi vài giá chỉ trong vài phút khi có tin. Nếu chưa có kinh nghiệm, hãy giao dịch khối lượng nhỏ (bắt đầu từ 0.01 lot) và luôn đặt stop loss.</p>
            </div>
          ) : (
            <p className="muted small">1 pip {symbol} = {pip} giá.</p>
          )}
        </section>

        <section className="card result">
          {r ? (
            <>
              <div className="hero-label">Khối lượng vào lệnh</div>
              <div className="hero">{r.lots.toFixed(2)} <span>lot</span></div>
              {r.lots === 0 && <p className="warn">⚠ Mức rủi ro này nhỏ hơn 0.01 lot. Hãy nới % rủi ro hoặc thu hẹp stop loss.</p>}
              {wrongSide && <p className="warn">⚠ Stop loss và take profit đang nằm cùng một phía so với giá vào.</p>}
              {sampleLot.length > 0 && <p className="warn">⚠ Số lot đang tính theo giá mẫu của {sampleLot.map((q) => q.key).join(', ')} vì chưa lấy được giá thật. Kiểm tra mạng, hoặc nhập giá trên MT5 vào mục "Giá hiện tại" bên dưới.</p>}
              {r.margin > settings.balance && <p className="warn">⚠ Ký quỹ cần thiết vượt số dư. Lệnh này không mở được với đòn bẩy hiện tại.</p>}
              <div className="tiles">
                <Tile tone="neg" label="Rủi ro thực tế" value={money(r.actualRisk, ccy)} sub={`${r.actualRiskPct.toFixed(2)}% số dư · mục tiêu ${money(r.riskAmount, ccy)}`} />
                <Tile tone="neg" label="Stop loss" value={`${sl.toFixed(1)} pip`} sub={`Chính xác: ${r.lotsExact.toFixed(4)} lot`} />
                <Tile label="Giá trị 1 pip" value={money(r.pipValuePerLot * r.lots, ccy)} sub={`${money(r.pipValuePerLot, ccy)} cho 1 lot`} />
                <Tile label="Ký quỹ cần" value={money(r.margin, ccy)} sub={`${r.units.toLocaleString('en-US')} đơn vị · đòn bẩy 1:${settings.leverage}${sampleMargin ? ' · theo giá mẫu' : ''}`} />
                {r.rr != null && r.reward != null && (
                  <Tile tone="pos" label="Lợi nhuận nếu chạm TP" value={money(r.reward, ccy)} sub={`Tỷ lệ R:R = 1:${r.rr.toFixed(2)}`} />
                )}
              </div>
              <p className="muted small">Lot được làm tròn xuống bội số 0.01 để rủi ro không vượt mức đã đặt. Chưa tính spread, phí và trượt giá.</p>
            </>
          ) : (
            <p className="muted">Nhập đủ số dư, % rủi ro và stop loss để xem kết quả.</p>
          )}
        </section>
      </div>

      <details className="card quotes-box">
        <summary>
          <span className="quotes-title">Giá hiện tại (để tính chính xác)</span>
          <span className="muted small">
            {auto.busy ? 'Đang cập nhật…' : updated ? `Tự cập nhật lúc ${updated}` : 'Chưa cập nhật'}
            {sampleLot.length > 0 && <span className="neg"> · cặp này đang dùng giá mẫu</span>}
          </span>
        </summary>
        {auto.message && <p className="warn">⚠ {auto.message}</p>}
        <p className="muted small">App tự lấy giá khi mở và mỗi 15 phút: từ MT5 nếu đã nối, không thì từ internet. Bạn không cần làm gì.</p>
        {needed.length === 0 ? (
          <p className="small">{symbol} không cần giá nào để quy đổi khi tài khoản dùng {ccy}.</p>
        ) : (
          <ul className="quote-needs">
            {needed.map((q) => (
              <li key={q.key}>
                {quoteInput(q.key)}
                <p className="small"><span className={q.role === 'lot' ? 'chip-role lot' : 'chip-role'}>{q.role === 'lot' ? 'Ảnh hưởng số lot' : 'Chỉ ảnh hưởng ký quỹ'}</span> {q.why}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button onClick={auto.refresh} disabled={auto.busy}>{auto.busy ? 'Đang cập nhật…' : 'Cập nhật ngay'}</button>
          <button className="ghost" onClick={() => setAllQuotes(!allQuotes)} aria-expanded={allQuotes}>{allQuotes ? 'Ẩn bảng đầy đủ' : 'Xem tất cả giá'}</button>
        </div>
        {allQuotes && (
          <>
            <div className="quotes">{QUOTE_KEYS.map(quoteInput)}</div>
            <div className="actions"><button className="ghost" onClick={() => patch({ quotes: SAMPLE_QUOTES, quoteFrom: {}, quotesUpdatedAt: null })}>Về giá trị mẫu</button></div>
          </>
        )}
      </details>
    </>
  )
}
