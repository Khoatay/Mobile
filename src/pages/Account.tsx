import { fromOf, neededQuotes } from '../lib/quotes'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ask } from '../lib/ask'
import { Field, Num, Tile } from '../components/Field'
import { badges, bridgeType, BROKERS, CATEGORIES, categoryOf, GROUP_SUGGESTIONS, groupsOf, isView, PHASES, ROLE_TEXT, type AccountInfo, type Category, type Env, type InfoMap, type Role } from '../lib/accounts'
import EquityChart from '../components/EquityChart'
import { computeStats } from '../lib/stats'
import { netOf } from '../lib/types'
import { partnerFor } from '../lib/partners'
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
  /** Mở trang Copy lệnh với tài khoản này làm nguồn. */
  onCopyFrom?: (id: string) => void
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
      {neededQuotes(symbol, acc.currency).some((q) => q.role === 'lot' && fromOf(settings, q.key) === 'sample') && <p className="warn">⚠ {symbol} cần quy đổi về {acc.currency} nhưng giá dùng để đổi vẫn là số mẫu. Bấm "Cập nhật tỷ giá" ở trên trước khi tin vào số lot.</p>}
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
      <Field label="Nhóm tài khoản" hint="Đổi để chuyển sang tab khác">
        <select value={info.role} onChange={(e) => onChange({ role: e.target.value as Role })}>
          {(Object.keys(ROLE_TEXT) as Role[]).map((r) => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}
        </select>
      </Field>
      {info.role === 'prop' && <Field label="Giai đoạn" hint="Với tài khoản quỹ">
        <input list="phases" value={info.phase} placeholder="Vòng 1, Vòng 2…" onChange={(e) => onChange({ phase: e.target.value })} />
        <datalist id="phases">{PHASES.map((p) => <option key={p} value={p} />)}</datalist>
      </Field>}
      {info.role !== 'view' && <Field label="Nhóm" hint="Gộp thống kê theo nhóm này">
        <input list="acc-groups" value={info.group} placeholder="Real, Quỹ A…" onChange={(e) => onChange({ group: e.target.value })} />
        <datalist id="acc-groups">{[...new Set([...groups, ...GROUP_SUGGESTIONS])].map((g) => <option key={g} value={g} />)}</datalist>
      </Field>}
      <Field label="Ghi chú"><input value={info.note} placeholder={info.role === 'view' ? 'VD: anh Nam, chiến lược vàng phiên Âu' : 'VD: mua ngày 01/11, hết hạn 30/11'} onChange={(e) => onChange({ note: e.target.value })} /></Field>
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
function AddAccount({ bridge, groups, onAdded, role }: { bridge: BridgeState; groups: string[]; onAdded: (id: string, info: AccountInfo) => void; role: Role }) {
  const blank: AccountInfo = { label: '', broker: '', env: 'real', role, phase: '', group: '', note: '' }
  const view = role === 'view'
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
        allow_trading: trading && !view, max_lot: maxLot,
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
      {view && (
        <section className="card notice-card">
          <h3>Theo dõi tài khoản của người khác</h3>
          <p className="muted small">Bạn cần số tài khoản, máy chủ và <strong>mật khẩu view (investor)</strong> do chủ tài khoản đưa. App thấy số dư, equity và lệnh đang mở của họ trực tiếp, vài giây cập nhật một lần, nhưng không đặt hay đóng lệnh được.</p>
          <p className="warn">⚠ Mỗi tài khoản theo dõi cần một bản MT5 riêng trên máy (khoảng 150–300 MB RAM mỗi bản). Máy tính thông thường nên theo dõi tối đa khoảng 5–10 tài khoản; nhiều hơn thì máy chậm và dữ liệu có thể trễ. Cần nhiều hơn thì dùng thêm máy hoặc VPS chạy bridge riêng. Xem thêm ở trang Hướng dẫn → Kết nối.</p>
        </section>
      )}
      <section className="card">
        <h3>Thông tin đăng nhập MT5</h3>
        <div className="prop-form">
          <Field label="Số tài khoản"><input inputMode="numeric" value={login} onChange={(e) => setLogin(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label={view ? 'Mật khẩu view (investor)' : 'Mật khẩu'} hint={view ? 'Người đó lấy trong MT5: Tools → Options → Server → Change (investor). Chỉ xem được, không đặt lệnh được.' : 'Mật khẩu view chỉ xem được; mật khẩu giao dịch mới vào lệnh được'}><input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
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
        {!view && <label className="inline wrap" style={{ marginTop: 12 }}>
          <input type="checkbox" className="check" checked={trading} onChange={(e) => setTrading(e.target.checked)} /> Cho phép vào lệnh từ app (cần mật khẩu giao dịch)
        </label>}
        {view && <p className="muted small" style={{ marginTop: 12 }}>Chỉ theo dõi tài khoản mà chủ tài khoản đã đồng ý chia sẻ mật khẩu view với bạn.</p>}
        {!view && trading && <div className="row" style={{ marginTop: 8, maxWidth: 260 }}><Field label="Khối lượng tối đa mỗi lệnh (lot)"><Num value={maxLot} onChange={setMaxLot} step={0.01} min={0.01} /></Field></div>}
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy || !login || !password || !server || !path} onClick={submit}>{busy ? 'Đang thêm…' : 'Thêm tài khoản'}</button>
        </div>
        {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
        <p className="muted small">Mật khẩu được lưu trong file <code>bridge/config.json</code> trên máy bạn, không gửi đi đâu khác.</p>
      </section>
    </>
  )
}

/** Hiệu suất của một tài khoản (thường là Only view): đọc lịch sử từ MT5, tính ngay, không lưu vào Nhật ký của bạn. */
function Performance({ id, currency, serverOffset }: { id: string; currency: string; serverOffset: number }) {
  const [days, setDays] = useState(30)
  const [list, setList] = useState<Trade[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let stop = false
    setList(null); setErr('')
    bridgeGet<{ deals: Mt5Deal[]; orders: Mt5Order[] }>(`/history?days=${days}&account=${id}`)
      .then((h) => { if (!stop) setList(dealsToTrades(h.deals, h.orders, id)) })
      .catch((e) => { if (!stop) setErr(errText(e)) })
    return () => { stop = true }
  }, [id, days])
  const s = useMemo(() => (list ? computeStats(list, serverOffset) : null), [list, serverOffset])
  const recent = useMemo(() => (list ? [...list].sort((a, b) => b.closeTime - a.closeTime).slice(0, 8) : []), [list])
  return (
    <section className="card">
      <div className="card-head">
        <h3>Kết quả giao dịch</h3>
        <div className="seg">
          {[7, 30, 90, 365].map((d) => <button key={d} className={days === d ? 'active' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>{d === 365 ? '1 năm' : `${d} ngày`}</button>)}
        </div>
      </div>
      {err && <p className="notice bad">⚠ {err}</p>}
      {!s && !err && <p className="muted">Đang đọc lịch sử…</p>}
      {s && s.n === 0 && <p className="muted">Không có lệnh nào đóng trong {days} ngày qua.</p>}
      {s && s.n > 0 && (
        <>
          <div className="tiles wide">
            <Tile tone={s.net} label="Lãi/lỗ ròng" value={`${signed(s.net)} ${currency}`} sub={`${s.n} lệnh`} />
            <Tile label="Tỷ lệ thắng" value={`${Math.round(s.winRate * 100)}%`} sub={`${s.wins} thắng · ${s.losses} thua`} />
            <Tile label="Profit factor" value={Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'} sub="Lãi gộp / lỗ gộp" />
            <Tile tone="neg" label="Sụt giảm lớn nhất" value={money(s.maxDrawdown, currency)} sub={`Chuỗi thua dài nhất ${s.maxLosingStreak} lệnh`} />
          </div>
          <EquityChart points={s.equity} ccy={currency} />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Đóng lúc</th><th>Cặp</th><th>Chiều</th><th className="num">Lot</th><th className="num">Lãi/lỗ</th></tr></thead>
              <tbody>{recent.map((t) => { const n = netOf(t); return <tr key={t.id}><td className="nowrap">{fmtServerTime(t.closeTime).slice(0, 16)}</td><td>{t.symbol}</td><td>{t.side === 'buy' ? 'Buy' : 'Sell'}</td><td className="num">{t.volume.toFixed(2)}</td><td className="num strong"><span className={n > 0 ? 'pip pos' : n < 0 ? 'pip neg' : 'pip'} />{signed(n)}</td></tr> })}</tbody>
            </table>
          </div>
          <p className="muted small">Đọc trực tiếp từ MT5 mỗi lần mở, không đưa vào Nhật ký hay Thống kê của bạn.</p>
        </>
      )}
    </section>
  )
}

/** Hai cách copy lệnh của một tài khoản Only view: chép ngay trên app, hoặc theo dõi chiến lược của họ trên nền tảng copy trade của sàn. */
function CopyGuide({ id, info, links, onCopyFrom }: { id: string; info: AccountInfo; links?: PartnerLinks; onCopyFrom?: (id: string) => void }) {
  const partner = partnerFor(info.broker)
  const link = partner ? links?.[partner.id] : undefined
  const broker = info.broker || 'sàn của họ'
  return (
    <section className="card">
      <h3>Muốn copy lệnh của người này?</h3>
      <p className="muted small">Có hai cách. Chỉ copy khi chủ tài khoản đồng ý, và luôn thử trên tài khoản demo trước.</p>
      <div className="copy-ways">
        <div className="copy-way">
          <span className="chip">Cách 1</span>
          <h4>Copy ngay trên app</h4>
          <p className="small">Bridge thấy lệnh mới của họ và mở lệnh tương tự trên tài khoản của bạn trong vài giây. Lot tự chỉnh được: nhân hệ số, theo tỷ lệ số dư hoặc lot cố định.</p>
          <ul className="small">
            <li><b>Cần:</b> một tài khoản của bạn có mật khẩu giao dịch và bật "Cho phép vào lệnh từ app".</li>
            <li><b>Cần:</b> máy tính chạy bridge luôn bật. Tắt máy là ngừng chép.</li>
            <li><b>Lưu ý:</b> trễ vài giây nên giá vào có thể khác họ; chỉ chép lệnh mở sau khi bật.</li>
          </ul>
          <button className="primary" onClick={() => onCopyFrom?.(id)}>Thiết lập copy từ tài khoản này</button>
        </div>
        <div className="copy-way">
          <span className="chip">Cách 2</span>
          <h4>Copy qua nền tảng của {broker}</h4>
          <p className="small">Nhiều sàn có sẵn copy trade, ví dụ Exness Social Trading. Nếu người này đăng chiến lược trên đó, bạn mở tài khoản copy ở cùng sàn và bấm theo dõi họ.</p>
          <ul className="small">
            <li><b>Ưu điểm:</b> chạy trên máy chủ của sàn, không cần bật máy tính, không trễ vì máy bạn.</li>
            <li><b>Cách làm:</b> xin họ tên hoặc link chiến lược → mở tài khoản copy ở {broker} → nạp tiền, bấm theo dõi, đặt mức dừng lỗ cho cả chiến lược.</li>
            <li>Sau đó thêm tài khoản copy đó vào tab <b>Copy trade</b> để theo dõi chung trong app.</li>
          </ul>
          {link?.url
            ? <a className="button primary" href={link.url} target="_blank" rel="noreferrer">{link.cta || `Mở tài khoản copy ở ${partner!.name}`}</a>
            : <p className="muted small">{info.broker ? `Chưa có link mở tài khoản ${info.broker}.` : 'Ghi broker của tài khoản này ở phần Nhãn để app gợi ý link mở tài khoản.'}</p>}
        </div>
      </div>
    </section>
  )
}

export default function Account({ bridge, trades, setTrades, settings, patch, infos, setInfo, links, onCopyFrom }: Props) {
  // tab: 'overview' hoặc một nhóm; sel: '' (danh sách của nhóm), 'add', hoặc số tài khoản.
  const [tab, setTab] = useState<'overview' | Category>('overview')
  const [sel, setSel] = useState('')
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const { accounts, metas } = bridge
  const live = (id: string) => accounts.find((a) => a.id === id)
  const fileOnly = useMemo(() => [...new Set(trades.map((t) => t.account).filter((a): a is string => !!a && !metas.some((m) => m.id === a)))], [trades, metas])
  const ids = [...metas.map((m) => m.id), ...fileOnly]
  const catIds = (c: Category) => ids.filter((id) => categoryOf(infos[id]) === c)
  const ownIds = ids.filter((id) => !isView(infos[id]))
  const ownLive = accounts.filter((a) => !isView(infos[a.id]))
  const groups = groupsOf(infos)
  const tradable = ownLive.filter((a) => a.tradable)
  const positionsOf = (list: LiveAccount[]) => list.flatMap((a) => a.positions.map((p) => ({ ...p, acc: a })))
  const name = (id: string) => infos[id]?.label ?? id
  const go = (t: 'overview' | Category, s = '') => { setTab(t); setSel(s); setMsg(null) }

  // Tài khoản vừa thêm chưa có trong danh sách của bridge ngay; giữ nó cho tới khi bridge báo về.
  const pending = useRef<string | null>(null)
  useEffect(() => {
    if (pending.current && ids.includes(pending.current)) pending.current = null
    if (sel && sel !== 'add' && sel !== pending.current && !ids.includes(sel)) setSel('')
    // Đổi nhóm của tài khoản đang mở (trong phần Nhãn): đi theo nó sang tab mới.
    if (sel && ids.includes(sel) && tab !== 'overview' && categoryOf(infos[sel]) !== tab) setTab(categoryOf(infos[sel]))
  }, [sel, tab, ids.join(), infos])

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
    patch({ quotes, quoteFrom: { ...settings.quoteFrom, ...Object.fromEntries(got.map((k) => [k, 'mt5' as const])) }, quotesUpdatedAt: Date.now() })
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
      setSel('')
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
    <div className="tabs" role="tablist" aria-label="Nhóm tài khoản">
      <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'tab active' : 'tab'} onClick={() => go('overview')}>Tổng quan</button>
      {CATEGORIES.map((c) => (
        <button key={c.id} role="tab" aria-selected={tab === c.id} className={tab === c.id ? `tab active cat-${c.id}` : `tab cat-${c.id}`} onClick={() => go(c.id)}>
          {c.label} <small>{catIds(c.id).length}</small>
        </button>
      ))}
    </div>
  )

  const notice = msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>

  /** Bảng tài khoản: dùng ở Tổng quan (mọi tài khoản của bạn) và ở từng nhóm. */
  const table = (list: string[], showCat: boolean, total = true) => {
    const liveList = list.map(live).filter((a): a is LiveAccount => !!a)
    const ccys = [...new Set(liveList.map((a) => a.currency))]
    const sum = (f: (a: LiveAccount) => number) => liveList.reduce((s, a) => s + f(a), 0)
    return (
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tài khoản</th><th>Nhãn</th>{showCat && <th>Nhóm</th>}<th className="num">Số dư</th><th className="num">Equity</th><th className="num">Đang treo</th><th className="num">Lệnh mở</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {list.map((id) => {
              const a = live(id)
              const meta = metas.find((m) => m.id === id)
              const info = infos[id]
              return (
                <tr key={id} className="clickable" onClick={() => go(categoryOf(info), id)}>
                  <td><strong>{name(id)}</strong><div className="muted small">{a ? `${a.login} · ${a.server}` : id}</div></td>
                  <td>{info && badges(info).filter((b) => b !== ROLE_TEXT[info.role]).map((b) => <span key={b} className="chip">{b}</span>)}{meta?.tradable && <span className="chip trade">Vào lệnh được</span>}</td>
                  {showCat && <td><span className={`chip cat-${categoryOf(info)}`}>{CATEGORIES.find((c) => c.id === categoryOf(info))!.label}</span></td>}
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
          {total && liveList.length > 1 && ccys.length === 1 && (
            <tfoot>
              <tr>
                <td className="strong">Tổng</td><td />{showCat && <td />}
                <td className="num strong">{money(sum((a) => a.balance), ccys[0])}</td>
                <td className="num strong">{money(sum((a) => a.equity), ccys[0])}</td>
                <td className="num strong">{signed(sum((a) => a.profit))}</td>
                <td className="num strong">{positionsOf(liveList).length}</td><td />
              </tr>
            </tfoot>
          )}
        </table>
        {total && liveList.length > 1 && ccys.length > 1 && <p className="muted small">Các tài khoản dùng tiền tệ khác nhau ({ccys.join(', ')}) nên không cộng tổng.</p>}
      </div>
    )
  }

  // ---------- Tổng quan: mọi tài khoản của bạn (không gồm Only view)
  if (tab === 'overview') {
    const viewCount = catIds('view').length
    return (
      <>
        <h1>Tài khoản</h1>
        {!bridge.online && <BridgeSetup />}
        {(bridge.online || ids.length > 0) && tabs}
        {bridge.online && ownIds.length === 0 && (
          <section className="card empty">
            <p>Chưa có tài khoản nào của bạn.</p>
            <div className="actions" style={{ justifyContent: 'center' }}>{CATEGORIES.filter((c) => c.id !== 'view').map((c) => <button key={c.id} onClick={() => go(c.id, 'add')}>+ {c.label}</button>)}</div>
          </section>
        )}
        {ownIds.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h3>{ownLive.length}/{ownIds.filter((id) => metas.some((m) => m.id === id)).length} tài khoản của bạn đang kết nối</h3>
              {syncControls(ownLive, 'Đưa lịch sử mọi tài khoản vào Nhật ký')}
            </div>
            {table(ownIds, true)}
            {ownLive.some((a) => infos[a.id]?.role === 'prop') && ownLive.length > 1 && <p className="muted small">Tổng gồm cả vốn của quỹ, không phải tiền của bạn.</p>}
            <p className="muted small">Bấm vào một dòng để xem chi tiết và sửa nhãn. Tài khoản Only view không tính vào đây.</p>
            {notice}
          </section>
        )}
        {viewCount > 0 && (
          <section className="card row-card">
            <div><strong>Đang theo dõi {viewCount} tài khoản Only view</strong><p className="muted small">Tài khoản của người khác, không tính vào tổng của bạn.</p></div>
            <button onClick={() => go('view')}>Xem</button>
          </section>
        )}
        {ownLive.length > 0 && <PositionsTable rows={positionsOf(ownLive)} infos={infos} busy={busy} onClose={closePosition} showAccount />}
        {tradable.length > 0 && <OrderTicket accounts={tradable} trades={trades} settings={settings} onDone={bridge.refresh} infos={infos} />}
      </>
    )
  }

  // ---------- một nhóm: Real, Quỹ, Copy trade, Only view
  const cat = CATEGORIES.find((c) => c.id === tab)!
  const list = catIds(cat.id)
  const view = cat.id === 'view'
  const sub = (
    <div className="subtabs" role="tablist" aria-label={`Tài khoản ${cat.label}`}>
      <button role="tab" aria-selected={sel === ''} className={sel === '' ? 'chip-tab active' : 'chip-tab'} onClick={() => setSel('')}>Tất cả</button>
      {list.map((id) => (
        <button key={id} role="tab" aria-selected={sel === id} className={sel === id ? 'chip-tab active' : 'chip-tab'} onClick={() => setSel(id)}>
          <span className={live(id) ? 'led on' : 'led'} /> {name(id)}
          {infos[id]?.env === 'demo' && <small>Demo</small>}{infos[id]?.phase && <small>{infos[id].phase}</small>}
        </button>
      ))}
      <button role="tab" aria-selected={sel === 'add'} className={sel === 'add' ? 'chip-tab add active' : 'chip-tab add'} onClick={() => setSel('add')}>+ Thêm {view ? 'tài khoản theo dõi' : `tài khoản ${cat.label}`}</button>
    </div>
  )
  const header = (<><h1>Tài khoản</h1>{tabs}<p className="muted cat-blurb">{cat.blurb}</p>{sub}</>)

  if (sel === 'add') {
    return (
      <>
        {header}
        <AddAccount key={cat.id} role={cat.role} bridge={bridge} groups={groups} onAdded={(id, info) => { pending.current = id; setInfo(id, info); setSel(id) }} />
      </>
    )
  }

  if (sel === '') {
    const liveList = list.map(live).filter((a): a is LiveAccount => !!a)
    return (
      <>
        {header}
        {!bridge.online && <BridgeSetup />}
        {list.length === 0 ? (
          <section className="card empty">
            <p>{view ? 'Chưa theo dõi tài khoản nào.' : `Chưa có tài khoản ${cat.label} nào.`}</p>
            <button className="primary" onClick={() => setSel('add')}>+ Thêm {view ? 'tài khoản theo dõi' : `tài khoản ${cat.label}`}</button>
          </section>
        ) : (
          <section className="card">
            <div className="card-head">
              <h3>{liveList.length}/{list.length} tài khoản đang kết nối</h3>
              {!view && syncControls(liveList, 'Đưa lịch sử vào Nhật ký')}
            </div>
            {table(list, false, !view)}
            {view && <p className="muted small">Số liệu đọc trực tiếp từ MT5 bằng mật khẩu view, vài giây cập nhật một lần. Bấm vào một tài khoản để xem kết quả giao dịch và cách copy lệnh.</p>}
            {view && list.length >= 10 && <p className="warn">⚠ Đang theo dõi {list.length} tài khoản. Từ khoảng 10 tài khoản trở lên, máy thường dễ chậm và dữ liệu có thể trễ; nên bớt tài khoản hoặc chạy thêm bridge trên máy khác/VPS.</p>}
            {notice}
          </section>
        )}
        {liveList.length > 0 && <PositionsTable rows={positionsOf(liveList)} infos={infos} busy={busy} onClose={closePosition} showAccount />}
      </>
    )
  }

  // ---------- một tài khoản
  const id = sel
  const info = infos[id]
  const a = live(id)
  const meta = metas.find((m) => m.id === id)
  const count = trades.filter((t) => t.account === id).length
  return (
    <>
      {header}
      <section className="card">
        <div className="card-head">
          <h3>{name(id)} <span className="muted small">· {a ? `${a.login} · ${a.server}` : id}</span></h3>
          {a && !view && syncControls([a], 'Đưa lịch sử vào Nhật ký')}
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
        {!view && <p className="muted small">{count} lệnh của tài khoản này trong Nhật ký.</p>}
        {notice}
      </section>
      {a && <PositionsTable rows={positionsOf([a])} infos={infos} busy={busy} onClose={closePosition} showAccount={false} />}
      {view && a && <Performance id={id} currency={a.currency} serverOffset={settings.serverOffset} />}
      {view && info && <CopyGuide id={id} info={info} links={links} onCopyFrom={onCopyFrom} />}
      <section className="card">
        <h3>Nhãn tài khoản</h3>
        {info && <InfoEditor info={info} groups={groups} onChange={(p) => setInfo(id, p)} />}
        <p className="muted small">Nhãn lưu trên trình duyệt này.{!view && ' Nhóm dùng để gộp thống kê ở trang Thống kê và Chia sẻ.'}</p>
      </section>
      {info?.role === 'prop' && (
        <section className="fund-embed">
          <h2 className="section-title">Theo dõi quỹ</h2>
          <FundPanel id={id} allTrades={trades} settings={settings} bridge={bridge} infos={infos} links={links} />
        </section>
      )}
      {a?.tradable && !view && <OrderTicket accounts={[a]} trades={trades} settings={settings} onDone={bridge.refresh} infos={infos} />}
      {meta && (
        <section className="card">
          <h3>Gỡ tài khoản</h3>
          <p className="muted small">Ngừng kết nối và xoá khỏi <code>config.json</code>.{!view && ' Lệnh trong Nhật ký và nhãn vẫn giữ.'}</p>
          <button className="ghost danger" disabled={busy} onClick={() => removeAccount(id)}>Gỡ khỏi bridge</button>
        </section>
      )}
    </>
  )
}
