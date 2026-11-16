import { useMemo, useState } from 'react'
import BarTable from '../components/BarTable'
import EquityChart from '../components/EquityChart'
import ScopeSelect from '../components/ScopeSelect'
import { badges, currenciesIn, groupsOf, inScope, scopeLabel, type InfoMap } from '../lib/accounts'
import { Tile } from '../components/Field'
import { duration, money, pct, signed } from '../lib/format'
import { computeStats } from '../lib/stats'
import { computeInsights } from '../lib/insights'
import type { Settings, Trade } from '../lib/types'

const RANGES = [
  { id: 'all', label: 'Tất cả', days: 0 },
  { id: '7', label: '7 ngày', days: 7 },
  { id: '30', label: '30 ngày', days: 30 },
  { id: '90', label: '90 ngày', days: 90 },
  { id: '365', label: '1 năm', days: 365 },
]

export default function Dashboard({ trades, settings, infos, goJournal }: { trades: Trade[]; settings: Settings; infos: InfoMap; goJournal: () => void }) {
  const [range, setRange] = useState('all')
  const [symbol, setSymbol] = useState('')
  const [side, setSide] = useState('')
  const [scope, setScope] = useState('')
  const accountIds = useMemo(() => [...new Set(trades.map((t) => t.account).filter((a): a is string => !!a))].sort(), [trades])
  const scopeCcy = currenciesIn(scope, Object.fromEntries(accountIds.map((id) => [id, infos[id]]).filter(([, i]) => i)))
  const ccy = scopeCcy.length === 1 ? scopeCcy[0] : settings.accountCcy

  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades])
  // Lọc theo thời gian, cặp và chiều lệnh; chưa lọc theo tài khoản (bảng so sánh cần cả).
  const base = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)!.days
    // Mốc tính từ lệnh gần nhất, để file lịch sử cũ vẫn lọc được.
    const latest = Math.max(0, ...trades.map((t) => t.closeTime))
    const from = days ? latest - days * 86_400_000 : -Infinity
    return trades.filter((t) => t.closeTime >= from && (!symbol || t.symbol === symbol) && (!side || t.side === side))
  }, [trades, range, symbol, side])
  const filtered = useMemo(() => base.filter((t) => inScope(scope, t.account, infos)), [base, scope, infos])

  // Bảng so sánh: mỗi nhóm và mỗi tài khoản một dòng.
  const compare = useMemo(() => {
    if (accountIds.length < 2) return []
    const groups = groupsOf(Object.fromEntries(accountIds.map((id) => [id, infos[id]]).filter(([, i]) => i)))
    const row = (key: string, label: string, sub: string, list: Trade[], kind: 'group' | 'account') => ({ key, label, sub, kind, s: computeStats(list, settings.serverOffset) })
    return [
      ...groups.map((g) => {
        const members = accountIds.filter((id) => infos[id]?.group.trim() === g)
        return row(`g:${g}`, `Nhóm ${g}`, `${members.length} tài khoản`, base.filter((t) => t.account && members.includes(t.account)), 'group')
      }),
      ...accountIds.map((id) => row(`a:${id}`, infos[id]?.label ?? id, infos[id] ? badges(infos[id]).join(' · ') : '', base.filter((t) => t.account === id), 'account')),
    ]
  }, [base, accountIds, infos, settings.serverOffset])
  const s = useMemo(() => computeStats(filtered, settings.serverOffset), [filtered, settings.serverOffset])
  const insights = useMemo(() => computeInsights(filtered, settings.serverOffset), [filtered, settings.serverOffset])
  const [allInsights, setAllInsights] = useState(false)

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
        <ScopeSelect value={scope} onChange={setScope} infos={infos} ids={accountIds} />
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
            <Tile tone={s.net} label="Lãi/lỗ ròng" value={`${signed(s.net)} ${ccy}`} sub={`${s.n} lệnh · đã trừ phí và swap`} />
            <Tile label="Tỷ lệ thắng" value={pct(s.winRate)} sub={`${s.wins} thắng · ${s.losses} thua`} />
            <Tile tone={s.profitFactor >= 1 ? 1 : -1} label="Profit factor" value={Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'} sub={`Lãi gộp ${money(s.grossProfit)} / lỗ gộp ${money(s.grossLoss)}`} />
            <Tile tone={s.expectancy} label="Kỳ vọng mỗi lệnh" value={`${signed(s.expectancy)} ${ccy}`} sub={s.avgR == null ? 'Chưa có lệnh nào kèm SL' : `Trung bình ${signed(s.avgR)}R trên ${s.rCount} lệnh có SL`} />
            <Tile label="Sụt giảm lớn nhất" value={money(s.maxDrawdown, ccy)} sub={`Chuỗi thua dài nhất: ${s.maxLosingStreak} lệnh`} />
            <Tile label="Thắng TB / thua TB" value={s.payoff ? s.payoff.toFixed(2) : '–'} sub={`${money(s.avgWin)} / ${money(s.avgLoss)} · giữ TB ${duration(s.avgHoldMs)}`} />
          </div>

          {insights.length > 0 && (
            <section className="card insights">
              <h3>Nhận xét từ nhật ký</h3>
              <ul>
                {insights.slice(0, allInsights ? undefined : 4).map((x) => (
                  <li key={x.id} className={`insight ${x.tone}`}>
                    <span className="insight-icon" aria-hidden="true">{x.tone === 'bad' ? '!' : x.tone === 'good' ? '✓' : 'i'}</span>
                    <div><strong>{x.title}</strong><p>{x.detail}</p></div>
                  </li>
                ))}
              </ul>
              {insights.length > 4 && <button className="ghost mini" onClick={() => setAllInsights(!allInsights)}>{allInsights ? 'Thu gọn' : `Xem thêm ${insights.length - 4} nhận xét`}</button>}
              <p className="muted small">Tự động tìm từ các lệnh đang lọc; chỉ kết luận khi nhóm có từ 8 lệnh trở lên. Mẫu càng lớn càng đáng tin.</p>
            </section>
          )}
          {scopeCcy.length > 1 && <p className="warn">⚠ {scopeLabel(scope, infos)} gồm tài khoản dùng nhiều loại tiền ({scopeCcy.join(', ')}). Các con số tiền bên dưới đang cộng thẳng, chưa quy đổi.</p>}
          <section className="card">
            <h3>Lãi/lỗ luỹ kế ({ccy}){scope && ` · ${scopeLabel(scope, infos)}`}</h3>
            <EquityChart points={s.equity} ccy={ccy} />
          </section>

          {compare.length > 0 && (
            <section className="card">
              <h3>So sánh nhóm và tài khoản</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Phạm vi</th><th className="num">Lệnh</th><th className="num">Lãi/lỗ ròng</th><th className="num">Tỷ lệ thắng</th><th className="num">Profit factor</th><th className="num">Kỳ vọng / lệnh</th><th className="num">Sụt giảm lớn nhất</th><th /></tr></thead>
                  <tbody>
                    {compare.map((r) => (
                      <tr key={r.key} className={r.kind === 'group' ? 'group-row' : ''}>
                        <td><span className={r.kind === 'group' ? 'strong' : ''}>{r.label}</span>{r.sub && <div className="muted small">{r.sub}</div>}</td>
                        <td className="num">{r.s.n}</td>
                        <td className="num strong"><span className={r.s.net > 0 ? 'pip pos' : r.s.net < 0 ? 'pip neg' : 'pip'} />{signed(r.s.net)}</td>
                        <td className="num">{r.s.n ? pct(r.s.winRate) : '–'}</td>
                        <td className="num">{!r.s.n ? '–' : Number.isFinite(r.s.profitFactor) ? r.s.profitFactor.toFixed(2) : '∞'}</td>
                        <td className="num">{r.s.n ? signed(r.s.expectancy) : '–'}</td>
                        <td className="num">{r.s.n ? money(r.s.maxDrawdown) : '–'}</td>
                        <td><button className="ghost" aria-pressed={scope === r.key} onClick={() => setScope(scope === r.key ? '' : r.key)}>{scope === r.key ? 'Bỏ chọn' : 'Xem'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">Cùng bộ lọc thời gian, cặp và chiều lệnh ở trên. Lệnh nhập từ file không có số tài khoản sẽ không nằm trong dòng nào. Đặt nhóm cho tài khoản ở trang Tài khoản.</p>
            </section>
          )}

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
