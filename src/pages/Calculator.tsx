import { useState } from 'react'
import { Field, Num, Tile } from '../components/Field'
import { calcPosition, CURRENCIES, PAIRS, parseSymbol, pipSize, QUOTE_KEYS, SAMPLE_QUOTES } from '../lib/forex'
import { money } from '../lib/format'
import type { Settings } from '../lib/types'

interface Props { settings: Settings; patch: (p: Partial<Settings>) => void }

export default function Calculator({ settings, patch }: Props) {
  const [symbol, setSymbol] = useState('EURUSD')
  const [mode, setMode] = useState<'pips' | 'price'>('pips')
  const [slPips, setSlPips] = useState(20)
  const [tpPips, setTpPips] = useState(40)
  const [entry, setEntry] = useState(NaN)
  const [slPrice, setSlPrice] = useState(NaN)
  const [tpPrice, setTpPrice] = useState(NaN)
  const [fetching, setFetching] = useState(false)
  const [fetchMsg, setFetchMsg] = useState('')

  const info = parseSymbol(symbol)!
  const pip = pipSize(info)
  const sl = mode === 'pips' ? slPips : Math.abs(entry - slPrice) / pip
  const tp = mode === 'pips' ? tpPips : Math.abs(tpPrice - entry) / pip
  const ccy = settings.accountCcy
  const r = calcPosition({
    symbol, accountCcy: ccy, balance: settings.balance, riskPct: settings.riskPct,
    slPips: sl, tpPips: Number.isFinite(tp) ? tp : undefined, leverage: settings.leverage, quotes: settings.quotes,
  })
  const wrongSide = mode === 'price' && [entry, slPrice, tpPrice].every(Number.isFinite) && (tpPrice - entry) * (slPrice - entry) > 0

  async function fetchQuotes() {
    setFetching(true)
    setFetchMsg('')
    try {
      const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,AUD,NZD,JPY,CHF,CAD')
      if (!res.ok) throw new Error(String(res.status))
      const rates = (await res.json()).rates as Record<string, number>
      const q = { ...settings.quotes }
      for (const c of ['EUR', 'GBP', 'AUD', 'NZD']) if (rates[c] > 0) q[c + 'USD'] = Number((1 / rates[c]).toFixed(5))
      for (const c of ['JPY', 'CHF', 'CAD']) if (rates[c] > 0) q['USD' + c] = Number(rates[c].toFixed(c === 'JPY' ? 3 : 5))
      patch({ quotes: q, quotesUpdatedAt: Date.now() })
      setFetchMsg('Đã cập nhật tỷ giá tiền tệ (tỷ giá tham chiếu cuối ngày). Vàng, bạc vẫn phải nhập tay.')
    } catch {
      setFetchMsg('Không lấy được tỷ giá. Hãy nhập tay theo giá trên MT4/MT5.')
    } finally {
      setFetching(false)
    }
  }

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
            <Field label="Rủi ro mỗi lệnh (%)"><Num value={settings.riskPct} onChange={(v) => patch({ riskPct: v })} step={0.1} min={0} /></Field>
            <Field label="Đòn bẩy (1:x)"><Num value={settings.leverage} onChange={(v) => patch({ leverage: v })} min={1} /></Field>
          </div>
          <div className="seg" role="tablist" aria-label="Cách nhập stop loss">
            <button role="tab" aria-selected={mode === 'pips'} className={mode === 'pips' ? 'active' : ''} onClick={() => setMode('pips')}>Nhập theo pip</button>
            <button role="tab" aria-selected={mode === 'price'} className={mode === 'price' ? 'active' : ''} onClick={() => setMode('price')}>Nhập theo giá</button>
          </div>
          {mode === 'pips' ? (
            <div className="row">
              <Field label="Stop loss (pip)"><Num value={slPips} onChange={setSlPips} min={0} /></Field>
              <Field label="Take profit (pip)" hint="Không bắt buộc"><Num value={tpPips} onChange={setTpPips} min={0} /></Field>
            </div>
          ) : (
            <div className="row">
              <Field label="Giá vào"><Num value={entry} onChange={setEntry} /></Field>
              <Field label="Giá stop loss"><Num value={slPrice} onChange={setSlPrice} /></Field>
              <Field label="Giá take profit" hint="Không bắt buộc"><Num value={tpPrice} onChange={setTpPrice} /></Field>
            </div>
          )}
          <p className="muted small">1 pip {symbol} = {pip} giá. {info.base === 'XAU' && 'Vàng: 1 lot = 100 oz, tức 10 USD mỗi pip.'}</p>
        </section>

        <section className="card result">
          {r ? (
            <>
              <div className="hero-label">Khối lượng vào lệnh</div>
              <div className="hero">{r.lots.toFixed(2)} <span>lot</span></div>
              {r.lots === 0 && <p className="warn">⚠ Mức rủi ro này nhỏ hơn 0.01 lot. Hãy nới % rủi ro hoặc thu hẹp stop loss.</p>}
              {wrongSide && <p className="warn">⚠ Stop loss và take profit đang nằm cùng một phía so với giá vào.</p>}
              {r.margin > settings.balance && <p className="warn">⚠ Ký quỹ cần thiết vượt số dư. Lệnh này không mở được với đòn bẩy hiện tại.</p>}
              <div className="tiles">
                <Tile label="Rủi ro thực tế" value={money(r.actualRisk, ccy)} sub={`${r.actualRiskPct.toFixed(2)}% số dư · mục tiêu ${money(r.riskAmount, ccy)}`} />
                <Tile label="Stop loss" value={`${sl.toFixed(1)} pip`} sub={`Chính xác: ${r.lotsExact.toFixed(4)} lot`} />
                <Tile label="Giá trị 1 pip" value={money(r.pipValuePerLot * r.lots, ccy)} sub={`${money(r.pipValuePerLot, ccy)} cho 1 lot`} />
                <Tile label="Ký quỹ cần" value={money(r.margin, ccy)} sub={`${r.units.toLocaleString('en-US')} đơn vị · đòn bẩy 1:${settings.leverage}`} />
                {r.rr != null && r.reward != null && (
                  <Tile label="Lợi nhuận nếu chạm TP" value={money(r.reward, ccy)} sub={`Tỷ lệ R:R = 1:${r.rr.toFixed(2)}`} />
                )}
              </div>
              <p className="muted small">Lot được làm tròn xuống bội số 0.01 để rủi ro không vượt mức đã đặt. Chưa tính spread, phí và trượt giá.</p>
            </>
          ) : (
            <p className="muted">Nhập đủ số dư, % rủi ro và stop loss để xem kết quả.</p>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Tỷ giá dùng để quy đổi</h3>
          <div className="actions">
            <button onClick={fetchQuotes} disabled={fetching}>{fetching ? 'Đang tải…' : 'Cập nhật từ internet'}</button>
            <button className="ghost" onClick={() => patch({ quotes: SAMPLE_QUOTES, quotesUpdatedAt: null })}>Về giá trị mẫu</button>
          </div>
        </div>
        {settings.quotesUpdatedAt == null ? (
          <p className="warn">⚠ Đang dùng tỷ giá mẫu, không phải giá thị trường. Hãy cập nhật hoặc nhập theo giá trên MT4/MT5 trước khi tính lệnh thật.</p>
        ) : (
          <p className="muted small">Cập nhật lần cuối: {new Date(settings.quotesUpdatedAt).toLocaleString('vi-VN')}</p>
        )}
        {fetchMsg && <p className="muted small">{fetchMsg}</p>}
        <div className="quotes">
          {QUOTE_KEYS.map((k) => (
            <Field key={k} label={k}>
              <Num value={settings.quotes[k]} onChange={(v) => patch({ quotes: { ...settings.quotes, [k]: v }, quotesUpdatedAt: Date.now() })} min={0} />
            </Field>
          ))}
        </div>
        <p className="muted small">Tỷ giá ảnh hưởng tới giá trị pip của cặp không kết thúc bằng {ccy} và tới ký quỹ. Các cặp chéo được suy ra từ bảng này.</p>
      </section>
    </>
  )
}
