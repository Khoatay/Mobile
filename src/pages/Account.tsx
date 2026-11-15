import { useEffect, useMemo, useState } from 'react'
import { Field, Num } from '../components/Field'
import { ACCOUNT_TYPE, bridgeGet, bridgePost, type BridgeState, type LiveAccount, type Mt5Deal, type Mt5Order } from '../lib/bridge'
import { calcPosition, normalizeSymbol, PAIRS, parseSymbol, pipSize, QUOTE_KEYS } from '../lib/forex'
import { money, signed } from '../lib/format'
import { dealsToTrades } from '../lib/mt5deals'
import { fmtServerTime } from '../lib/parse'
import { evaluateProp, type PropConfig } from '../lib/prop'
import { mergeTrades, usePersistent } from '../lib/store'
import type { Settings, Side, Trade } from '../lib/types'

interface Props {
  bridge: BridgeState
  trades: Trade[]
  setTrades: (t: Trade[]) => void
  settings: Settings
  patch: (p: Partial<Settings>) => void
}
type Msg = { ok: boolean; text: string } | null
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

export function BridgeSetup() {
  return (
    <section className="card">
      <h3>Chưa thấy chương trình nền (bridge) trên máy này</h3>
      <p className="muted">Trình duyệt không tự đăng nhập MT5 hay Telegram được. Một chương trình nhỏ trong thư mục <code>bridge/</code> làm việc đó và chỉ mở cổng nội bộ trên máy bạn.</p>
      <ol className="steps">
        <li>Máy Windows đã cài Python 3.10 trở lên, và mỗi tài khoản có một bản MT5 cài ở thư mục riêng.</li>
        <li>Trong thư mục <code>bridge</code>: <code>pip install -r requirements.txt</code></li>
        <li>Sao chép <code>config.example.json</code> thành <code>config.json</code>, khai báo từng tài khoản: số tài khoản, <strong>mật khẩu view (investor)</strong>, tên máy chủ và đường dẫn tới <code>terminal64.exe</code> của bản MT5 tương ứng.</li>
        <li>Chạy <code>python bridge.py</code>. Trang này tự nhận ra sau vài giây.</li>
      </ol>
      <p className="muted small">Mật khẩu view chỉ cho xem, không đặt hay đóng lệnh được. File <code>config.json</code> nằm trên máy bạn và không được đưa lên git.</p>
    </section>
  )
}

/** Phiếu vào lệnh thị trường: tính lot từ % rủi ro và stop loss, hỏi lại trước khi gửi. */
function OrderTicket({ accounts, trades, settings, onDone }: { accounts: LiveAccount[]; trades: Trade[]; settings: Settings; onDone: () => void }) {
  const [accId, setAccId] = useState(accounts[0].id)
  const [symbol, setSymbol] = useState('EURUSD')
  const [side, setSide] = useState<Side>('buy')
  const [sl, setSl] = useState(NaN)
  const [tp, setTp] = useState(NaN)
  const [riskPct, setRiskPct] = useState(settings.riskPct)
  const [lotInput, setLotInput] = useState(NaN)
  const [tick, setTick] = useState<{ bid: number; ask: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [configs] = usePersistent<Record<string, PropConfig>>('fx.props', {})
  const acc = accounts.find((a) => a.id === accId) ?? accounts[0]

  useEffect(() => {
    let stop = false
    setTick(null)
    const pull = () => bridgeGet<Record<string, { bid: number; ask: number }>>(`/prices?symbols=${symbol}&account=${acc.id}`)
      .then((p) => { if (!stop) setTick(p[symbol] ?? null) }).catch(() => { if (!stop) setTick(null) })
    pull()
    const id = setInterval(pull, 3000)
    return () => { stop = true; clearInterval(id) }
  }, [symbol, acc.id])

  const info = parseSymbol(symbol)!
  const price = tick ? (side === 'buy' ? tick.ask : tick.bid) : NaN
  const slPips = Math.abs(price - sl) / pipSize(info)
  const slOk = Number.isFinite(sl) && Number.isFinite(price) && (side === 'buy' ? sl < price : sl > price)
  const tpOk = !Number.isFinite(tp) || (side === 'buy' ? tp > price : tp < price)
  const calc = slOk ? calcPosition({ symbol, accountCcy: acc.currency, balance: acc.balance, riskPct, slPips, leverage: acc.leverage, quotes: settings.quotes }) : null
  const lots = Number.isFinite(lotInput) ? lotInput : calc?.lots ?? 0
  const risk = calc ? lots * slPips * calc.pipValuePerLot : NaN

  // Nếu tài khoản có bộ luật quỹ, không cho gửi lệnh mà khoản lỗ tối đa vượt khoảng còn lại.
  const room = useMemo(() => {
    const cfg = configs[acc.id]
    if (!cfg) return null
    const mine = trades.filter((t) => t.account === acc.id)
    return evaluateProp(mine, cfg, Date.now() + settings.serverOffset * 3_600_000, acc.profit).room
  }, [configs, acc.id, acc.profit, trades, settings.serverOffset])
  const overRoom = room != null && Number.isFinite(risk) && risk > room
  const ready = slOk && tpOk && lots > 0 && Number.isFinite(risk) && !overRoom

  async function submit() {
    const summary = `${side === 'buy' ? 'BUY' : 'SELL'} ${lots.toFixed(2)} lot ${symbol} trên "${acc.label}" (${acc.login})\n` +
      `Giá khoảng ${price} · SL ${sl}${Number.isFinite(tp) ? ` · TP ${tp}` : ''}\nLỗ tối đa khoảng ${money(risk, acc.currency)}\n\nGửi lệnh THẬT này?`
    if (!confirm(summary)) return
    setBusy(true)
    try {
      const r = await bridgePost<{ deal: number; price: number; volume: number }>('/order', { account: acc.id, symbol, side, volume: lots, sl, tp: Number.isFinite(tp) ? tp : 0 })
      setMsg({ ok: true, text: `Đã khớp ${r.volume} lot ${symbol} tại ${r.price} (deal ${r.deal}).` })
      setLotInput(NaN)
      onDone()
    } catch (e) { setMsg({ ok: false, text: errText(e) }) }
    finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h3>Vào lệnh thị trường</h3>
      <div className="prop-form">
        <Field label="Tài khoản">
          <select value={acc.id} onChange={(e) => setAccId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {money(a.balance, a.currency, 0)}</option>)}
          </select>
        </Field>
        <Field label="Cặp tiền"><select value={symbol} onChange={(e) => { setSymbol(e.target.value); setSl(NaN); setTp(NaN); setLotInput(NaN) }}>{PAIRS.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Chiều">
          <div className="seg">
            <button className={side === 'buy' ? 'active' : ''} aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>Buy</button>
            <button className={side === 'sell' ? 'active' : ''} aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>Sell</button>
          </div>
        </Field>
        <Field label="Giá stop loss (bắt buộc)"><Num value={sl} onChange={(v) => { setSl(v); setLotInput(NaN) }} /></Field>
        <Field label="Giá take profit"><Num value={tp} onChange={setTp} /></Field>
        <Field label="Rủi ro (%)"><Num value={riskPct} onChange={(v) => { setRiskPct(v); setLotInput(NaN) }} step={0.1} min={0} /></Field>
        <Field label="Khối lượng (lot)" hint="Tự tính; sửa tay nếu muốn"><Num value={Number.isFinite(lotInput) ? lotInput : calc?.lots ?? NaN} onChange={setLotInput} step={0.01} min={0} /></Field>
      </div>
      <p className="ticket-line">
        {tick ? <>Giá hiện tại: <strong>{tick.bid}</strong> / <strong>{tick.ask}</strong></> : <span className="muted">Đang lấy giá…</span>}
        {slOk && Number.isFinite(risk) && <> · SL cách {slPips.toFixed(1)} pip · lỗ tối đa khoảng <strong>{money(risk, acc.currency)}</strong> ({((risk / acc.balance) * 100).toFixed(2)}% số dư)</>}
        {room != null && Number.isFinite(room) && <> · luật quỹ còn cho lỗ {money(room, acc.currency)}</>}
      </p>
      {Number.isFinite(sl) && tick && !slOk && <p className="warn">⚠ Stop loss phải nằm {side === 'buy' ? 'dưới' : 'trên'} giá hiện tại.</p>}
      {tick && !tpOk && <p className="warn">⚠ Take profit phải nằm {side === 'buy' ? 'trên' : 'dưới'} giá hiện tại.</p>}
      {overRoom && <p className="warn">⛔ Khoản lỗ tối đa của lệnh này vượt khoảng còn được lỗ theo luật quỹ. Hãy giảm khối lượng.</p>}
      {settings.quotesUpdatedAt == null && info.quote !== acc.currency && <p className="warn">⚠ {symbol} cần quy đổi về {acc.currency} nhưng bảng tỷ giá vẫn là số mẫu. Bấm "Cập nhật tỷ giá" ở trên trước khi tin vào số lot.</p>}
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
      <div className="actions">
        <button className="primary" disabled={!ready || busy} onClick={submit}>{busy ? 'Đang gửi…' : `Gửi lệnh ${side === 'buy' ? 'Buy' : 'Sell'} ${lots > 0 ? lots.toFixed(2) + ' lot' : ''}`}</button>
        <span className="muted small">Lệnh thật, khớp theo giá thị trường lúc gửi. App hỏi lại một lần trước khi gửi.</span>
      </div>
    </section>
  )
}

export default function Account({ bridge, trades, setTrades, settings, patch }: Props) {
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const { accounts, metas } = bridge
  const tradable = accounts.filter((a) => a.tradable)
  const currencies = [...new Set(accounts.map((a) => a.currency))]
  const total = (f: (a: LiveAccount) => number) => accounts.reduce((s, a) => s + f(a), 0)
  const positions = accounts.flatMap((a) => a.positions.map((p) => ({ ...p, acc: a })))

  async function run(fn: () => Promise<string>) {
    setBusy(true)
    try { setMsg({ ok: true, text: await fn() }) }
    catch (e) { setMsg({ ok: false, text: errText(e) }) }
    finally { setBusy(false) }
  }

  const syncHistory = () => run(async () => {
    let all = trades
    const parts: string[] = []
    for (const a of accounts) {
      try {
        const h = await bridgeGet<{ deals: Mt5Deal[]; orders: Mt5Order[] }>(`/history?days=${days}&account=${a.id}`)
        const merged = mergeTrades(all, dealsToTrades(h.deals, h.orders, a.id))
        all = merged.trades
        parts.push(`${a.label}: thêm ${merged.added} lệnh`)
      } catch (e) { parts.push(`${a.label}: lỗi (${errText(e)})`) }
    }
    setTrades(all)
    return parts.join(' · ')
  })

  const syncQuotes = () => run(async () => {
    const p = await bridgeGet<Record<string, { bid: number; ask: number }>>(`/prices?symbols=${QUOTE_KEYS.join(',')}`)
    const quotes = { ...settings.quotes }
    const got = QUOTE_KEYS.filter((k) => p[k])
    if (!got.length) throw new Error('Broker không trả giá cho cặp nào.')
    for (const k of got) quotes[k] = Number(((p[k].bid + p[k].ask) / 2).toPrecision(7))
    patch({ quotes, quotesUpdatedAt: Date.now() })
    return `Đã cập nhật ${got.length}/${QUOTE_KEYS.length} tỷ giá từ ${accounts[0].label}.`
  })

  const closePosition = (acc: LiveAccount, ticket: number, label: string) => {
    if (!confirm(`Đóng lệnh ${label} trên "${acc.label}" theo giá thị trường?`)) return
    run(async () => {
      const r = await bridgePost<{ price: number }>('/close', { account: acc.id, ticket })
      bridge.refresh()
      return `Đã đóng lệnh ${label} tại ${r.price}.`
    })
  }

  return (
    <>
      <h1>Tài khoản MT5</h1>
      {!bridge.online && <BridgeSetup />}
      {bridge.online && metas.length === 0 && <p className="notice bad">⚠ Bridge đang chạy nhưng chưa khai báo tài khoản nào trong <code>config.json</code>.</p>}
      {metas.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>{accounts.length}/{metas.length} tài khoản đang kết nối</h3>
            <div className="actions">
              <select aria-label="Khoảng thời gian" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
                <option value={30}>30 ngày</option><option value={90}>90 ngày</option><option value={365}>1 năm</option><option value={3650}>Toàn bộ</option>
              </select>
              <button className="primary" disabled={busy || !accounts.length} onClick={syncHistory}>Đưa lịch sử mọi tài khoản vào Nhật ký</button>
              <button disabled={busy || !accounts.length} onClick={syncQuotes}>Cập nhật tỷ giá</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tài khoản</th><th>Loại</th><th className="num">Số dư</th><th className="num">Equity</th><th className="num">Đang treo</th><th className="num">Lệnh mở</th><th className="num">Ký quỹ trống</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {metas.map((m) => {
                  const a = accounts.find((x) => x.id === m.id)
                  return (
                    <tr key={m.id}>
                      <td><strong>{m.label}</strong>{a && <div className="muted small">{a.login} · {a.server}</div>}</td>
                      <td><span className="chip">{ACCOUNT_TYPE[m.type]}</span>{m.tradable && <span className="chip trade">Vào lệnh được</span>}</td>
                      {a ? (
                        <>
                          <td className="num">{money(a.balance, a.currency)}</td>
                          <td className="num strong">{money(a.equity, a.currency)}</td>
                          <td className="num"><span className={a.profit > 0 ? 'pip pos' : a.profit < 0 ? 'pip neg' : 'pip'} />{signed(a.profit)}</td>
                          <td className="num">{a.positions.length}</td>
                          <td className="num">{money(a.marginFree)}</td>
                          <td><span className="led on" /> Đã nối</td>
                        </>
                      ) : <td colSpan={6} className="muted">⚠ {m.error || 'Chưa kết nối'}</td>}
                    </tr>
                  )
                })}
              </tbody>
              {accounts.length > 1 && currencies.length === 1 && (
                <tfoot>
                  <tr>
                    <td className="strong">Tổng</td><td />
                    <td className="num strong">{money(total((a) => a.balance), currencies[0])}</td>
                    <td className="num strong">{money(total((a) => a.equity), currencies[0])}</td>
                    <td className="num strong">{signed(total((a) => a.profit))}</td>
                    <td className="num strong">{positions.length}</td><td /><td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {accounts.length > 1 && currencies.length > 1 && <p className="muted small">Các tài khoản dùng tiền tệ khác nhau ({currencies.join(', ')}) nên không cộng tổng.</p>}
          {accounts.some((a) => a.type === 'prop') && accounts.length > 1 && <p className="muted small">Tổng gồm cả vốn của quỹ, không phải tiền của bạn.</p>}
          {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
        </section>
      )}

      {accounts.length > 0 && (
        <section className="card">
          <h3>{positions.length} lệnh đang mở</h3>
          {positions.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Tài khoản</th><th>Mở lúc</th><th>Cặp</th><th>Chiều</th><th className="num">Lot</th><th className="num">Giá mở</th><th className="num">Hiện tại</th><th className="num">SL</th><th className="num">TP</th><th className="num">Lãi/lỗ</th><th /></tr></thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.acc.id + ':' + p.ticket}>
                      <td>{p.acc.label}</td>
                      <td className="nowrap">{fmtServerTime(p.time * 1000).slice(0, 16)}</td>
                      <td>{normalizeSymbol(p.symbol)}</td>
                      <td>{p.side === 'buy' ? 'Buy' : 'Sell'}</td>
                      <td className="num">{p.volume.toFixed(2)}</td>
                      <td className="num">{p.openPrice}</td>
                      <td className="num">{p.price}</td>
                      <td className="num">{p.sl || '–'}</td>
                      <td className="num">{p.tp || '–'}</td>
                      <td className="num strong"><span className={p.profit > 0 ? 'pip pos' : p.profit < 0 ? 'pip neg' : 'pip'} />{signed(p.profit)}</td>
                      <td>{p.acc.tradable && <button disabled={busy} onClick={() => closePosition(p.acc, p.ticket, `${normalizeSymbol(p.symbol)} ${p.volume.toFixed(2)} lot`)}>Đóng</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {positions.some((p) => !p.sl) && <p className="warn">⚠ Có lệnh đang mở không đặt stop loss.</p>}
        </section>
      )}

      {tradable.length > 0 ? (
        <OrderTicket accounts={tradable} trades={trades} settings={settings} onDone={bridge.refresh} />
      ) : accounts.length > 0 && (
        <section className="card">
          <h3>Vào lệnh từ app đang tắt</h3>
          <p className="muted">Mật khẩu view không đặt lệnh được. Muốn vào lệnh từ đây, trong <code>config.json</code> hãy đổi mật khẩu của tài khoản đó thành mật khẩu giao dịch, thêm <code>"allow_trading": true</code> và <code>"max_lot"</code>, rồi chạy lại bridge.</p>
          <p className="muted small">Hãy thử trên tài khoản demo trước. Với tài khoản quỹ, kiểm tra điều khoản của quỹ về việc đặt lệnh qua phần mềm bên ngoài trước khi bật.</p>
        </section>
      )}
    </>
  )
}
