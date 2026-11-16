import { useEffect, useMemo, useRef, useState } from 'react'
import { ask } from '../lib/ask'
import { Field, Num, Tile } from '../components/Field'
import { badges, bridgeType, BROKERS, GROUP_SUGGESTIONS, groupsOf, PHASES, ROLE_TEXT, type AccountInfo, type Env, type InfoMap, type Role } from '../lib/accounts'
import { bridgeGet, bridgePost, type BridgeState, type LiveAccount, type LivePosition, type Mt5Deal, type Mt5Order } from '../lib/bridge'
import { calcPosition, normalizeSymbol, PAIRS, parseSymbol, pipSize, QUOTE_KEYS } from '../lib/forex'
import { money, signed } from '../lib/format'
import { dealsToTrades } from '../lib/mt5deals'
import { fmtServerTime } from '../lib/parse'
import { evaluateProp, type PropConfig } from '../lib/prop'
import type { PartnerLinks } from '../lib/partners'
import { FundPanel } from './Prop'
import { mergeTrades, usePersistent } from '../lib/store'
import type { Settings, Side, Trade } from '../lib/types'

interface Props {
  bridge: BridgeState
  trades: Trade[]
  setTrades: (t: Trade[]) => void
  settings: Settings
  patch: (p: Partial<Settings>) => void
  infos: InfoMap
  setInfo: (id: string, info: Partial<AccountInfo>) => void
  links?: PartnerLinks
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
function OrderTicket({ accounts, trades, settings, onDone, infos }: { accounts: LiveAccount[]; trades: Trade[]; settings: Settings; onDone: () => void; infos: InfoMap }) {
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
  useEffect(() => { if (!accounts.some((a) => a.id === accId)) setAccId(accounts[0].id) }, [accounts, accId])

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
    const summary = `${side === 'buy' ? 'BUY' : 'SELL'} ${lots.toFixed(2)} lot ${symbol} trên "${infos[acc.id]?.label ?? acc.label}" (${acc.login})\n` +
      `Giá khoảng ${price} · SL ${sl}${Number.isFinite(tp) ? ` · TP ${tp}` : ''}\nLỗ tối đa khoảng ${money(risk, acc.currency)}\n\nGửi lệnh THẬT này?`
    if (!(await ask(summary, 'Gửi lệnh'))) return
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
            {accounts.map((a) => <option key={a.id} value={a.id}>{infos[a.id]?.label ?? a.label} · {money(a.balance, a.currency, 0)}</option>)}
          </select>
        </Field>
        <Field label="Cặp tiền"><select value={symbol} onChange={(e) => { setSymbol(e.target.value); setSl(NaN); setTp(NaN); setLotInput(NaN) }}>{PAIRS.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field group label="Chiều">
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

/** Nhãn cho một tài khoản: tên, broker, Real/Demo, vai trò, giai đoạn, nhóm, ghi chú. */
function InfoEditor({ info, onChange, groups }: { info: AccountInfo; onChange: (p: Partial<AccountInfo>) => void; groups: string[] }) {
  return (
    <div className="prop-form">
      <Field label="Tên hiển thị"><input value={info.label} maxLength={40} onChange={(e) => onChange({ label: e.target.value })} /></Field>
      <Field label="Broker / quỹ">
        <input list="brokers" value={info.broker} placeholder="Exness, FTMO…" onChange={(e) => onChange({ broker: e.target.value })} />
        <datalist id="brokers">{BROKERS.map((b) => <option key={b} value={b} />)}</datalist>
      </Field>
      <Field group label="Real / Demo">
        <div className="seg">
          {(['real', 'demo'] as Env[]).map((v) => <button key={v} className={info.env === v ? 'active' : ''} aria-pressed={info.env === v} onClick={() => onChange({ env: v })}>{v === 'real' ? 'Real' : 'Demo'}</button>)}
        </div>
      </Field>
      <Field label="Vai trò">
        <select value={info.role} onChange={(e) => onChange({ role: e.target.value as Role })}>
          {(Object.keys(ROLE_TEXT) as Role[]).map((r) => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}
        </select>
      </Field>
      <Field label="Giai đoạn" hint="Với tài khoản quỹ">
        <input list="phases" value={info.phase} placeholder="Vòng 1, Vòng 2…" onChange={(e) => onChange({ phase: e.target.value })} />
        <datalist id="phases">{PHASES.map((p) => <option key={p} value={p} />)}</datalist>
      </Field>
      <Field label="Nhóm" hint="Gộp thống kê theo nhóm này">
        <input list="acc-groups" value={info.group} placeholder="Real, Quỹ A…" onChange={(e) => onChange({ group: e.target.value })} />
        <datalist id="acc-groups">{[...new Set([...groups, ...GROUP_SUGGESTIONS])].map((g) => <option key={g} value={g} />)}</datalist>
      </Field>
      <Field label="Ghi chú"><input value={info.note} placeholder="VD: mua ngày 01/11, hết hạn 30/11" onChange={(e) => onChange({ note: e.target.value })} /></Field>
    </div>
  )
}

function PositionsTable({ rows, infos, busy, onClose, showAccount }: { rows: (LivePosition & { acc: LiveAccount })[]; infos: InfoMap; busy: boolean; onClose: (acc: LiveAccount, p: LivePosition) => void; showAccount: boolean }) {
  return (
    <section className="card">
      <h3>{rows.length} lệnh đang mở</h3>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr>{showAccount && <th>Tài khoản</th>}<th>Mở lúc</th><th>Cặp</th><th>Chiều</th><th className="num">Lot</th><th className="num">Giá mở</th><th className="num">Hiện tại</th><th className="num">SL</th><th className="num">TP</th><th className="num">Lãi/lỗ</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.acc.id + ':' + p.ticket}>
                  {showAccount && <td>{infos[p.acc.id]?.label ?? p.acc.label}</td>}
                  <td className="nowrap">{fmtServerTime(p.time * 1000).slice(0, 16)}</td>
                  <td>{normalizeSymbol(p.symbol)}</td>
                  <td>{p.side === 'buy' ? 'Buy' : 'Sell'}</td>
                  <td className="num">{p.volume.toFixed(2)}</td>
                  <td className="num">{p.openPrice}</td>
                  <td className="num">{p.price}</td>
                  <td className="num">{p.sl || '–'}</td>
                  <td className="num">{p.tp || '–'}</td>
                  <td className="num strong"><span className={p.profit > 0 ? 'pip pos' : p.profit < 0 ? 'pip neg' : 'pip'} />{signed(p.profit)}</td>
                  <td>{p.acc.tradable && <button disabled={busy} onClick={() => onClose(p.acc, p)}>Đóng</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.some((p) => !p.sl) && <p className="warn">⚠ Có lệnh đang mở không đặt stop loss.</p>}
    </section>
  )
}

/** Thêm tài khoản vào bridge ngay từ app; bridge tự lưu vào config.json. */
function AddAccount({ bridge, groups, onAdded }: { bridge: BridgeState; groups: string[]; onAdded: (id: string, info: AccountInfo) => void }) {
  const blank: AccountInfo = { label: '', broker: '', env: 'real', role: 'own', phase: '', group: '', note: '' }
  const [info, setInfo] = useState<AccountInfo>(blank)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState('')
  const [path, setPath] = useState('')
  const [trading, setTrading] = useState(false)
  const [maxLot, setMaxLot] = useState(0.1)
  const [terminals, setTerminals] = useState<{ path: string; usedBy: string | null }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  const loadTerminals = () => bridgeGet<{ path: string; usedBy: string | null }[]>('/terminals')
    .then((t) => { setTerminals(t); setPath((cur) => cur || t.find((x) => !x.usedBy)?.path || '') })
    .catch(() => setTerminals([]))
  useEffect(() => { if (bridge.online) loadTerminals() }, [bridge.online, bridge.metas.length])

  if (!bridge.online) return <BridgeSetup />
  const free = (terminals ?? []).filter((t) => !t.usedBy)

  async function submit() {
    setBusy(true)
    try {
      const r = await bridgePost<{ id: string }>('/accounts/add', {
        label: info.label || login, type: bridgeType(info), login, password, server, terminal_path: path,
        allow_trading: trading, max_lot: maxLot,
      })
      onAdded(r.id, { ...info, label: info.label || login })
      setInfo(blank); setLogin(''); setPassword(''); setServer(''); setPath(''); setTrading(false)
      setMsg({ ok: true, text: 'Đã thêm. Bridge đang kết nối, tài khoản sẽ hiện sau vài giây.' })
      bridge.refresh()
    } catch (e) { setMsg({ ok: false, text: errText(e) }) }
    finally { setBusy(false) }
  }

  return (
    <>
      <section className="card">
        <h3>Thông tin đăng nhập MT5</h3>
        <div className="prop-form">
          <Field label="Số tài khoản"><input inputMode="numeric" value={login} onChange={(e) => setLogin(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Mật khẩu" hint="Mật khẩu view chỉ xem được; mật khẩu giao dịch mới vào lệnh được"><input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Máy chủ" hint="Chép đúng như trong MT5: File → Login to Trade Account"><input value={server} placeholder="Exness-MT5Real29" onChange={(e) => setServer(e.target.value.trim())} /></Field>
          <Field label="Bản MT5 dùng cho tài khoản này">
            <select value={path} onChange={(e) => setPath(e.target.value)}>
              <option value="">Chọn…</option>
              {(terminals ?? []).map((t) => <option key={t.path} value={t.path} disabled={!!t.usedBy}>{t.path}{t.usedBy ? ` (đang dùng cho ${t.usedBy})` : ''}</option>)}
            </select>
          </Field>
        </div>
        {terminals && free.length === 0 && (
          <div className="warn">
            ⚠ {terminals.length ? 'Mọi bản MT5 trên máy đều đã có tài khoản.' : 'Không tìm thấy bản MT5 nào ở thư mục cài đặt thông thường.'} Mỗi tài khoản cần một bản MT5 riêng.
            Cách thêm một bản: chạy bộ cài MT5 của broker hoặc quỹ (FTMO, The5ers… đều có bộ cài riêng), ở màn hình đầu bấm <strong>Settings</strong> và đổi thư mục cài, ví dụ <code>C:\Program Files\MT5 FTMO</code>. Cài xong bấm <button className="ghost" onClick={loadTerminals}>Tìm lại</button>
          </div>
        )}
        <details className="guide">
          <summary>Bản MT5 nằm ở thư mục khác?</summary>
          <Field label="Đường dẫn tới terminal64.exe"><input value={path} placeholder="D:\MT5\terminal64.exe" onChange={(e) => setPath(e.target.value)} /></Field>
        </details>
      </section>

      <section className="card">
        <h3>Nhãn tài khoản</h3>
        <InfoEditor info={info} groups={groups} onChange={(p) => setInfo({ ...info, ...p })} />
        <label className="inline wrap" style={{ marginTop: 12 }}>
          <input type="checkbox" className="check" checked={trading} onChange={(e) => setTrading(e.target.checked)} /> Cho phép vào lệnh từ app (cần mật khẩu giao dịch)
        </label>
        {trading && <div className="row" style={{ marginTop: 8, maxWidth: 260 }}><Field label="Khối lượng tối đa mỗi lệnh (lot)"><Num value={maxLot} onChange={setMaxLot} step={0.01} min={0.01} /></Field></div>}
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy || !login || !password || !server || !path} onClick={submit}>{busy ? 'Đang thêm…' : 'Thêm tài khoản'}</button>
        </div>
        {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
        <p className="muted small">Mật khẩu được lưu trong file <code>bridge/config.json</code> trên máy bạn, không gửi đi đâu khác.</p>
      </section>
    </>
  )
}

export default function Account({ bridge, trades, setTrades, settings, patch, infos, setInfo, links }: Props) {
  const [tab, setTab] = useState<string>('overview')
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const { accounts, metas } = bridge
  const live = (id: string) => accounts.find((a) => a.id === id)
  const fileOnly = useMemo(() => [...new Set(trades.map((t) => t.account).filter((a): a is string => !!a && !metas.some((m) => m.id === a)))], [trades, metas])
  const ids = [...metas.map((m) => m.id), ...fileOnly]
  const groups = groupsOf(infos)
  const tradable = accounts.filter((a) => a.tradable)
  const currencies = [...new Set(accounts.map((a) => a.currency))]
  const total = (f: (a: LiveAccount) => number) => accounts.reduce((s, a) => s + f(a), 0)
  const positionsOf = (list: LiveAccount[]) => list.flatMap((a) => a.positions.map((p) => ({ ...p, acc: a })))
  const name = (id: string) => infos[id]?.label ?? id

  // Tài khoản vừa thêm chưa có trong danh sách của bridge ngay; giữ tab của nó cho tới khi bridge báo về.
  const pending = useRef<string | null>(null)
  useEffect(() => {
    if (pending.current && ids.includes(pending.current)) pending.current = null
    if (tab !== 'overview' && tab !== 'add' && tab !== pending.current && !ids.includes(tab)) setTab('overview')
  }, [tab, ids.join()])

  async function run(fn: () => Promise<string>) {
    setBusy(true)
    try { setMsg({ ok: true, text: await fn() }) }
    catch (e) { setMsg({ ok: false, text: errText(e) }) }
    finally { setBusy(false) }
  }

  const syncHistory = (list: LiveAccount[]) => run(async () => {
    let all = trades
    const parts: string[] = []
    for (const a of list) {
      try {
        const h = await bridgeGet<{ deals: Mt5Deal[]; orders: Mt5Order[] }>(`/history?days=${days}&account=${a.id}`)
        const merged = mergeTrades(all, dealsToTrades(h.deals, h.orders, a.id))
        all = merged.trades
        parts.push(`${name(a.id)}: thêm ${merged.added} lệnh`)
      } catch (e) { parts.push(`${name(a.id)}: lỗi (${errText(e)})`) }
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
    return `Đã cập nhật ${got.length}/${QUOTE_KEYS.length} tỷ giá từ ${name(accounts[0].id)}.`
  })

  const closePosition = async (acc: LiveAccount, p: LivePosition) => {
    const label = `${normalizeSymbol(p.symbol)} ${p.volume.toFixed(2)} lot`
    if (!(await ask(`Đóng lệnh ${label} trên "${name(acc.id)}" theo giá thị trường?`, 'Đóng lệnh', true))) return
    run(async () => {
      const r = await bridgePost<{ price: number }>('/close', { account: acc.id, ticket: p.ticket })
      bridge.refresh()
      return `Đã đóng lệnh ${label} tại ${r.price}.`
    })
  }

  const removeAccount = async (id: string) => {
    if (!(await ask(`Gỡ "${name(id)}" khỏi bridge? Bridge sẽ ngừng kết nối và xoá tài khoản này khỏi config.json. Lệnh đã có trong Nhật ký vẫn giữ nguyên.`, 'Gỡ tài khoản', true))) return
    run(async () => {
      await bridgePost('/accounts/remove', { account: id })
      setTab('overview')
      bridge.refresh()
      return `Đã gỡ ${name(id)}.`
    })
  }

  const syncControls = (list: LiveAccount[], label: string) => (
    <div className="actions">
      <select aria-label="Khoảng thời gian" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
        <option value={30}>30 ngày</option><option value={90}>90 ngày</option><option value={365}>1 năm</option><option value={3650}>Toàn bộ</option>
      </select>
      <button className="primary" disabled={busy || !list.length} onClick={() => syncHistory(list)}>{label}</button>
      <button disabled={busy || !accounts.length} onClick={syncQuotes}>Cập nhật tỷ giá</button>
    </div>
  )

  const tabs = (
    <div className="tabs" role="tablist" aria-label="Tài khoản">
      <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'tab active' : 'tab'} onClick={() => setTab('overview')}>Tổng quan</button>
      {ids.map((id) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
          <span className={live(id) ? 'led on' : 'led'} /> {name(id)}
          {infos[id]?.phase && <small>{infos[id].phase}</small>}
        </button>
      ))}
      <button role="tab" aria-selected={tab === 'add'} className={tab === 'add' ? 'tab active add' : 'tab add'} onClick={() => setTab('add')}>+ Thêm tài khoản</button>
    </div>
  )

  const notice = msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>

  // ---------- tab Thêm tài khoản
  if (tab === 'add') {
    return (
      <>
        <h1>Tài khoản</h1>
        {tabs}
        <AddAccount bridge={bridge} groups={groups} onAdded={(id, info) => { pending.current = id; setInfo(id, info); setTab(id) }} />
      </>
    )
  }

  // ---------- tab một tài khoản
  if (tab !== 'overview') {
    const id = tab
    const info = infos[id]
    const a = live(id)
    const meta = metas.find((m) => m.id === id)
    const count = trades.filter((t) => t.account === id).length
    return (
      <>
        <h1>Tài khoản</h1>
        {tabs}
        <section className="card">
          <div className="card-head">
            <h3>{name(id)} <span className="muted small">· {a ? `${a.login} · ${a.server}` : id}</span></h3>
            {a && syncControls([a], 'Đưa lịch sử vào Nhật ký')}
          </div>
          {!meta && <p className="muted small">Tài khoản này chỉ có trong Nhật ký (nhập từ file báo cáo), chưa nối qua bridge.</p>}
          {meta && !a && <p className="notice bad">⚠ Chưa kết nối: {meta.error || 'đang thử lại…'}</p>}
          {a && (
            <div className="tiles wide">
              <Tile label="Số dư" value={money(a.balance, a.currency)} sub={`Đòn bẩy 1:${a.leverage}`} />
              <Tile tone={a.profit} label="Equity" value={money(a.equity, a.currency)} sub={`Lãi/lỗ đang treo ${signed(a.profit)}`} />
              <Tile label="Ký quỹ còn trống" value={money(a.marginFree, a.currency)} sub={`Đang dùng ${money(a.margin)}`} />
            </div>
          )}
          <p className="muted small">{count} lệnh của tài khoản này trong Nhật ký.</p>
          {notice}
        </section>
        <section className="card">
          <h3>Nhãn tài khoản</h3>
          {info && <InfoEditor info={info} groups={groups} onChange={(p) => setInfo(id, p)} />}
          <p className="muted small">Nhãn lưu trên trình duyệt này. Nhóm dùng để gộp thống kê ở trang Thống kê và Chia sẻ.</p>
        </section>
        {info?.role === 'prop' && (
          <section className="fund-embed">
            <h2 className="section-title">Theo dõi quỹ</h2>
            <FundPanel id={id} allTrades={trades} settings={settings} bridge={bridge} infos={infos} links={links} />
          </section>
        )}
        {a && <PositionsTable rows={positionsOf([a])} infos={infos} busy={busy} onClose={closePosition} showAccount={false} />}
        {a?.tradable && <OrderTicket accounts={[a]} trades={trades} settings={settings} onDone={bridge.refresh} infos={infos} />}
        {meta && (
          <section className="card">
            <h3>Gỡ tài khoản</h3>
            <p className="muted small">Ngừng kết nối và xoá khỏi <code>config.json</code>. Lệnh trong Nhật ký và nhãn vẫn giữ.</p>
            <button className="ghost danger" disabled={busy} onClick={() => removeAccount(id)}>Gỡ khỏi bridge</button>
          </section>
        )}
      </>
    )
  }

  // ---------- tab Tổng quan
  return (
    <>
      <h1>Tài khoản</h1>
      {!bridge.online && <BridgeSetup />}
      {(bridge.online || ids.length > 0) && tabs}
      {bridge.online && ids.length === 0 && (
        <section className="card empty">
          <p>Chưa có tài khoản nào.</p>
          <button className="primary" onClick={() => setTab('add')}>+ Thêm tài khoản</button>
        </section>
      )}
      {ids.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>{accounts.length}/{metas.length} tài khoản đang kết nối</h3>
            {syncControls(accounts, 'Đưa lịch sử mọi tài khoản vào Nhật ký')}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tài khoản</th><th>Nhãn</th><th>Nhóm</th><th className="num">Số dư</th><th className="num">Equity</th><th className="num">Đang treo</th><th className="num">Lệnh mở</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {ids.map((id) => {
                  const a = live(id)
                  const meta = metas.find((m) => m.id === id)
                  const info = infos[id]
                  return (
                    <tr key={id} className="clickable" onClick={() => setTab(id)}>
                      <td><strong>{name(id)}</strong><div className="muted small">{a ? `${a.login} · ${a.server}` : id}</div></td>
                      <td>{info && badges(info).map((b) => <span key={b} className="chip">{b}</span>)}{meta?.tradable && <span className="chip trade">Vào lệnh được</span>}</td>
                      <td>{info?.group || <span className="muted">–</span>}</td>
                      {a ? (
                        <>
                          <td className="num">{money(a.balance, a.currency)}</td>
                          <td className="num strong">{money(a.equity, a.currency)}</td>
                          <td className="num"><span className={a.profit > 0 ? 'pip pos' : a.profit < 0 ? 'pip neg' : 'pip'} />{signed(a.profit)}</td>
                          <td className="num">{a.positions.length}</td>
                          <td className="nowrap"><span className="led on" /> Đã nối</td>
                        </>
                      ) : <td colSpan={5} className="muted">{meta ? `⚠ ${meta.error || 'Chưa kết nối'}` : 'Chỉ có trong Nhật ký'}</td>}
                    </tr>
                  )
                })}
              </tbody>
              {accounts.length > 1 && currencies.length === 1 && (
                <tfoot>
                  <tr>
                    <td className="strong">Tổng</td><td /><td />
                    <td className="num strong">{money(total((a) => a.balance), currencies[0])}</td>
                    <td className="num strong">{money(total((a) => a.equity), currencies[0])}</td>
                    <td className="num strong">{signed(total((a) => a.profit))}</td>
                    <td className="num strong">{positionsOf(accounts).length}</td><td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {accounts.length > 1 && currencies.length > 1 && <p className="muted small">Các tài khoản dùng tiền tệ khác nhau ({currencies.join(', ')}) nên không cộng tổng.</p>}
          {accounts.some((a) => infos[a.id]?.role === 'prop') && accounts.length > 1 && <p className="muted small">Tổng gồm cả vốn của quỹ, không phải tiền của bạn.</p>}
          <p className="muted small">Bấm vào một dòng để xem chi tiết và sửa nhãn.</p>
          {notice}
        </section>
      )}
      {accounts.length > 0 && <PositionsTable rows={positionsOf(accounts)} infos={infos} busy={busy} onClose={closePosition} showAccount />}
      {tradable.length > 0 && <OrderTicket accounts={tradable} trades={trades} settings={settings} onDone={bridge.refresh} infos={infos} />}
    </>
  )
}
