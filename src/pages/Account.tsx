import { useState } from 'react'
import { Tile } from '../components/Field'
import { bridgeGet, type BridgeState, type Mt5Deal, type Mt5Order } from '../lib/bridge'
import { normalizeSymbol, QUOTE_KEYS } from '../lib/forex'
import { money, signed } from '../lib/format'
import { dealsToTrades } from '../lib/mt5deals'
import { fmtServerTime } from '../lib/parse'
import { mergeTrades } from '../lib/store'
import type { Settings, Trade } from '../lib/types'

interface Props {
  bridge: BridgeState
  trades: Trade[]
  setTrades: (t: Trade[]) => void
  settings: Settings
  patch: (p: Partial<Settings>) => void
}

export function BridgeSetup() {
  return (
    <section className="card">
      <h3>Chưa thấy chương trình nền (bridge) trên máy này</h3>
      <p className="muted">Trình duyệt không tự đăng nhập MT5 hay Telegram được. Một chương trình nhỏ trong thư mục <code>bridge/</code> làm việc đó và chỉ mở cổng nội bộ trên máy bạn.</p>
      <ol className="steps">
        <li>Máy Windows đã cài MT5 và Python 3.10 trở lên.</li>
        <li>Trong thư mục <code>bridge</code>: <code>pip install -r requirements.txt</code></li>
        <li>Sao chép <code>config.example.json</code> thành <code>config.json</code>, điền số tài khoản, <strong>mật khẩu view (investor)</strong> và tên máy chủ.</li>
        <li>Chạy <code>python bridge.py</code>. Trang này tự nhận ra sau vài giây.</li>
      </ol>
      <p className="muted small">Mật khẩu view chỉ cho xem, không đặt hay đóng lệnh được. File <code>config.json</code> nằm trên máy bạn và không được đưa lên git.</p>
    </section>
  )
}

export default function Account({ bridge, trades, setTrades, settings, patch }: Props) {
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const { account, status } = bridge

  async function run(fn: () => Promise<string>) {
    setBusy(true)
    try { setMsg({ ok: true, text: await fn() }) }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi không rõ' }) }
    finally { setBusy(false) }
  }

  const syncHistory = () => run(async () => {
    const h = await bridgeGet<{ deals: Mt5Deal[]; orders: Mt5Order[] }>(`/history?days=${days}`)
    const found = dealsToTrades(h.deals, h.orders)
    const merged = mergeTrades(trades, found)
    setTrades(merged.trades)
    return `Tìm thấy ${found.length} lệnh đã đóng trong ${days} ngày, thêm mới ${merged.added} lệnh vào Nhật ký.`
  })

  const syncQuotes = () => run(async () => {
    const p = await bridgeGet<Record<string, { bid: number; ask: number }>>(`/prices?symbols=${QUOTE_KEYS.join(',')}`)
    const quotes = { ...settings.quotes }
    const got = QUOTE_KEYS.filter((k) => p[k])
    for (const k of got) quotes[k] = Number(((p[k].bid + p[k].ask) / 2).toPrecision(7))
    if (!got.length) throw new Error('Broker không trả giá cho cặp nào.')
    patch({ quotes, quotesUpdatedAt: Date.now(), ...(account ? { balance: account.balance, accountCcy: account.currency, leverage: account.leverage } : {}) })
    return `Đã cập nhật ${got.length}/${QUOTE_KEYS.length} tỷ giá, cùng số dư, tiền tệ và đòn bẩy của tài khoản cho trang Tính lot.`
  })

  return (
    <>
      <h1>Tài khoản MT5</h1>
      {!bridge.online && <BridgeSetup />}
      {bridge.online && !account && (
        <p className="notice bad">⚠ Bridge đang chạy nhưng chưa nối được MT5: {status?.mt5.error || 'không rõ lý do'}</p>
      )}
      {account && (
        <>
          <div className="tiles wide">
            <Tile label="Số dư" value={money(account.balance, account.currency)} sub={`Tài khoản ${account.login} · ${account.server}`} />
            <Tile label="Equity" value={money(account.equity, account.currency)} sub={`Lãi/lỗ đang treo ${signed(account.profit)}`} />
            <Tile label="Ký quỹ còn trống" value={money(account.marginFree, account.currency)} sub={`Đang dùng ${money(account.margin)} · đòn bẩy 1:${account.leverage}`} />
          </div>

          <section className="card">
            <div className="card-head">
              <h3>Đồng bộ</h3>
              <div className="actions">
                <select aria-label="Khoảng thời gian" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
                  <option value={30}>30 ngày</option><option value={90}>90 ngày</option><option value={365}>1 năm</option><option value={3650}>Toàn bộ</option>
                </select>
                <button className="primary" disabled={busy} onClick={syncHistory}>Đưa lịch sử lệnh vào Nhật ký</button>
                <button disabled={busy} onClick={syncQuotes}>Cập nhật tỷ giá và số dư cho Tính lot</button>
              </div>
            </div>
            {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
            <p className="muted small">Lệnh đã có trong Nhật ký (kể cả từ file báo cáo MT5) không bị thêm trùng. Stop loss lấy theo mức đặt lúc mở lệnh.</p>
          </section>

          <section className="card">
            <h3>{account.positions.length} lệnh đang mở</h3>
            {account.positions.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Mở lúc</th><th>Cặp</th><th>Chiều</th><th className="num">Lot</th><th className="num">Giá mở</th><th className="num">Giá hiện tại</th><th className="num">SL</th><th className="num">TP</th><th className="num">Lãi/lỗ</th></tr></thead>
                  <tbody>
                    {account.positions.map((p) => (
                      <tr key={p.ticket}>
                        <td className="nowrap">{fmtServerTime(p.time * 1000).slice(0, 16)}</td>
                        <td>{normalizeSymbol(p.symbol)}</td>
                        <td>{p.side === 'buy' ? 'Buy' : 'Sell'}</td>
                        <td className="num">{p.volume.toFixed(2)}</td>
                        <td className="num">{p.openPrice}</td>
                        <td className="num">{p.price}</td>
                        <td className="num">{p.sl || '–'}</td>
                        <td className="num">{p.tp || '–'}</td>
                        <td className="num strong"><span className={p.profit > 0 ? 'pip pos' : p.profit < 0 ? 'pip neg' : 'pip'} />{signed(p.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {account.positions.some((p) => !p.sl) && <p className="warn">⚠ Có lệnh đang mở không đặt stop loss.</p>}
          </section>
        </>
      )}
    </>
  )
}
