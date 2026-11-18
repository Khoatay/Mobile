import { useState } from 'react'
import { Num } from '../components/Field'
import { calcPosition, CURRENCIES, PAIRS } from '../lib/forex'
import { money } from '../lib/format'
import { fromOf, neededQuotes } from '../lib/quotes'
import type { Settings } from '../lib/types'
import { POPULAR, priceMove, RISK_LEVELS, riskTone, slPresets } from './plain'

interface Props { settings: Settings; patch: (p: Partial<Settings>) => void }

/** Tính lot theo 4 bước, kết quả nói bằng tiền: "sai thì mất bao nhiêu, đúng thì được bao nhiêu". */
export default function LiteCalc({ settings, patch }: Props) {
  const [symbol, setSymbol] = useState('XAUUSD')
  const [sl, setSl] = useState(() => slPresets('XAUUSD')[1].pips)
  const [rr, setRr] = useState(2)
  const [more, setMore] = useState(false)
  const ccy = settings.accountCcy

  const pick = (s: string) => { setSymbol(s); setSl(slPresets(s)[1].pips) }
  const r = calcPosition({ symbol, accountCcy: ccy, balance: settings.balance, riskPct: settings.riskPct, slPips: sl, tpPips: sl * rr, leverage: settings.leverage, quotes: settings.quotes })
  const tone = riskTone(settings.riskPct)
  const name = POPULAR.find((p) => p.symbol === symbol)?.name ?? symbol

  return (
    <>
      <h1>Tính lệnh</h1>
      <p className="muted">Trả lời 4 câu hỏi, app cho bạn biết nên vào bao nhiêu lot.</p>

      <section className="lite-card">
        <div className="lite-step"><span>1</span>Bạn giao dịch gì?</div>
        <div className="lite-chips">
          {POPULAR.map((p) => (
            <button key={p.symbol} className={symbol === p.symbol ? 'lchip active' : 'lchip'} aria-pressed={symbol === p.symbol} onClick={() => pick(p.symbol)}>
              <strong>{p.symbol}</strong><small>{p.name}</small>
            </button>
          ))}
        </div>
        {more || !POPULAR.some((p) => p.symbol === symbol) ? (
          <select aria-label="Cặp khác" className="lite-select" value={symbol} onChange={(e) => pick(e.target.value)}>
            {PAIRS.map((p) => <option key={p}>{p}</option>)}
          </select>
        ) : (
          <button className="lite-link" onClick={() => setMore(true)}>Cặp khác…</button>
        )}
      </section>

      <section className="lite-card">
        <div className="lite-step"><span>2</span>Số vốn trong tài khoản</div>
        <div className="lite-money">
          <Num value={settings.balance} onChange={(v) => patch({ balance: v })} min={0} />
          <select aria-label="Loại tiền" value={ccy} onChange={(e) => patch({ accountCcy: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </section>

      <section className="lite-card">
        <div className="lite-step"><span>3</span>Nếu đoán sai, bạn chấp nhận mất bao nhiêu?</div>
        <div className="lite-chips three">
          {RISK_LEVELS.map((l) => (
            <button key={l.pct} className={settings.riskPct === l.pct ? 'lchip active' : 'lchip'} aria-pressed={settings.riskPct === l.pct} onClick={() => patch({ riskPct: l.pct })}>
              <strong>{l.label}</strong>
              <small>{money(settings.balance * l.pct / 100, ccy, 0)} · {l.pct}%</small>
            </button>
          ))}
        </div>
        <p className="muted small">{RISK_LEVELS.find((l) => l.pct === settings.riskPct)?.note ?? `Đang đặt ${settings.riskPct}% số vốn (đổi ở bản đầy đủ).`}</p>
        {tone !== 'ok' && <p className="warn">⚠ Mức {settings.riskPct}% mỗi lệnh là {tone === 'danger' ? 'rất' : 'khá'} cao. Vài lệnh thua liên tiếp có thể mất một phần lớn tài khoản.</p>}
      </section>

      <section className="lite-card">
        <div className="lite-step"><span>4</span>Cắt lỗ cách giá vào bao xa?</div>
        <div className="lite-chips three">
          {slPresets(symbol).map((p) => (
            <button key={p.pips} className={sl === p.pips ? 'lchip active' : 'lchip'} aria-pressed={sl === p.pips} onClick={() => setSl(p.pips)}>
              <strong>{p.label}</strong><small>{p.pips} pip</small>
            </button>
          ))}
        </div>
        <label className="lite-inline">Hoặc tự nhập <Num value={sl} onChange={setSl} min={0} /> pip</label>
        {sl > 0 && <p className="muted small">Tức là giá {name} đi ngược {priceMove(symbol, sl)} so với giá bạn vào thì lệnh tự đóng (stop loss).</p>}
        <div className="lite-rr">
          <span>Chốt lời gấp</span>
          {[1, 2, 3].map((x) => <button key={x} className={rr === x ? 'lchip mini active' : 'lchip mini'} aria-pressed={rr === x} onClick={() => setRr(x)}>{x} lần</button>)}
          <span>khoảng cắt lỗ</span>
        </div>
      </section>

      <section className="lite-card lite-answer" aria-live="polite">
        {r && r.lots > 0 ? (
          <>
            <div className="lite-label">Bạn nên vào</div>
            <div className="lite-big">{r.lots.toFixed(2)} <span>lot</span></div>
            <ul className="lite-outcome">
              <li className="neg"><span>Nếu sai (chạm cắt lỗ)</span><strong>mất {money(r.actualRisk, ccy)}</strong></li>
              {r.reward != null && <li className="pos"><span>Nếu đúng (chạm chốt lời)</span><strong>được {money(r.reward, ccy)}</strong></li>}
            </ul>
            <p className="muted small">Đặt stop loss {sl} pip và take profit {sl * rr} pip ngay khi vào lệnh trên MT5. Chưa tính phí, spread và trượt giá.</p>
            {r.margin > settings.balance && <p className="warn">⚠ Vốn không đủ ký quỹ cho lệnh này. Hãy chọn cắt lỗ xa hơn hoặc mức rủi ro thấp hơn.</p>}
          </>
        ) : r ? (
          <p className="warn">⚠ Số vốn này quá nhỏ cho mức cắt lỗ đã chọn (dưới 0.01 lot). Thử cắt lỗ gần hơn, hoặc nạp thêm vốn.</p>
        ) : (
          <p className="muted">Nhập số vốn và khoảng cắt lỗ để xem kết quả.</p>
        )}
      </section>
      {neededQuotes(symbol, ccy).some((q) => q.role === 'lot' && fromOf(settings, q.key) === 'sample') && <p className="muted small">Chưa lấy được giá thật nên kết quả có thể lệch một chút. Kiểm tra kết nối mạng.</p>}
    </>
  )
}
