import { useMemo, useState } from 'react'
import BarTable from '../components/BarTable'
import EquityChart from '../components/EquityChart'
import { Tile } from '../components/Field'
import { duration, money, pct, signed } from '../lib/format'
import { computeStats } from '../lib/stats'
import type { Settings, Trade } from '../lib/types'

const RANGES = [
  { id: 'all', label: 'Tất cả', days: 0 },
  { id: '7', label: '7 ngày', days: 7 },
  { id: '30', label: '30 ngày', days: 30 },
  { id: '90', label: '90 ngày', days: 90 },
  { id: '365', label: '1 năm', days: 365 },
]

export default function Dashboard({ trades, settings, labels, goJournal }: { trades: Trade[]; settings: Settings; labels: Record<string, string>; goJournal: () => void }) {
  const [range, setRange] = useState('all')
  const [symbol, setSymbol] = useState('')
  const [side, setSide] = useState('')
  const [account, setAccount] = useState('')
  const accountIds = useMemo(() => [...new Set(trades.map((t) => t.account).filter((a): a is string => !!a))].sort(), [trades])
  const ccy = settings.accountCcy

  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades])
  const filtered = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)!.days
    // Mốc tính từ lệnh gần nhất, để file lịch sử cũ vẫn lọc được.
    const latest = Math.max(0, ...trades.map((t) => t.closeTime))
    const from = days ? latest - days * 86_400_000 : -Infinity
    return trades.filter((t) => t.closeTime >= from && (!symbol || t.symbol === symbol) && (!side || t.side === side) && (!account || t.account === account))
  }, [trades, range, symbol, side, account])
  const s = useMemo(() => computeStats(filtered, settings.serverOffset), [filtered, settings.serverOffset])

  if (trades.length === 0)
    return (
      <>
        <h1>Thống kê</h1>
        <section className="card empty">
          <p>Chưa có lệnh nào để thống kê.</p>
          <button className="primary" onClick={goJournal}>Sang Nhật ký để import lệnh</button>
        </section>
      </>
    )

  return (
    <>
      <h1>Thống kê</h1>
      <div className="filters">
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.id} className={range === r.id ? 'active' : ''} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>
          ))}
        </div>
        {accountIds.length > 0 && (
          <select aria-label="Tài khoản" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Mọi tài khoản</option>
            {accountIds.map((a) => <option key={a} value={a}>{labels[a] ?? a}</option>)}
          </select>
        )}
        <select aria-label="Cặp tiền" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          <option value="">Mọi cặp</option>
          {symbols.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select aria-label="Chiều lệnh" value={side} onChange={(e) => setSide(e.target.value)}>
          <option value="">Buy và Sell</option><option value="buy">Chỉ Buy</option><option value="sell">Chỉ Sell</option>
        </select>
        <span className="legend"><i className="sw pos" /> Lãi <i className="sw neg" /> Lỗ</span>
      </div>

      {s.n === 0 ? (
        <section className="card empty"><p>Không có lệnh nào khớp bộ lọc.</p></section>
      ) : (
        <>
          <div className="tiles wide">
            <Tile label="Lãi/lỗ ròng" value={`${signed(s.net)} ${ccy}`} sub={`${s.n} lệnh · đã trừ phí và swap`} />
            <Tile label="Tỷ lệ thắng" value={pct(s.winRate)} sub={`${s.wins} thắng · ${s.losses} thua`} />
            <Tile label="Profit factor" value={Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'} sub={`Lãi gộp ${money(s.grossProfit)} / lỗ gộp ${money(s.grossLoss)}`} />
            <Tile label="Kỳ vọng mỗi lệnh" value={`${signed(s.expectancy)} ${ccy}`} sub={s.avgR == null ? 'Chưa có lệnh nào kèm SL' : `Trung bình ${signed(s.avgR)}R trên ${s.rCount} lệnh có SL`} />
            <Tile label="Sụt giảm lớn nhất" value={money(s.maxDrawdown, ccy)} sub={`Chuỗi thua dài nhất: ${s.maxLosingStreak} lệnh`} />
            <Tile label="Thắng TB / thua TB" value={s.payoff ? s.payoff.toFixed(2) : '–'} sub={`${money(s.avgWin)} / ${money(s.avgLoss)} · giữ TB ${duration(s.avgHoldMs)}`} />
          </div>

          <section className="card">
            <h3>Lãi/lỗ luỹ kế ({ccy})</h3>
            <EquityChart points={s.equity} ccy={ccy} />
          </section>

          <div className="grid-2">
            <BarTable title="Theo cặp tiền" rows={s.bySymbol} />
            <BarTable title="Theo phiên (giờ mở lệnh)" rows={s.bySession} note={`Quy đổi từ giờ máy chủ UTC+${settings.serverOffset}; không điều chỉnh giờ mùa hè.`} />
            <BarTable title="Theo ngày trong tuần" rows={s.byWeekday} />
            <BarTable title="Theo thời gian giữ lệnh" rows={s.byHold} />
            <BarTable title="Theo chiều lệnh" rows={s.bySide} />
            <BarTable title="Theo setup" rows={s.bySetup} note="Gắn setup cho từng lệnh ở trang Nhật ký." />
          </div>
        </>
      )}
    </>
  )
}
