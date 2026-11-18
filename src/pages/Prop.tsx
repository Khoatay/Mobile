import { useEffect, useMemo, useState } from 'react'
import { Field, Num, Tile } from '../components/Field'
import { ask } from '../lib/ask'
import { money, signed } from '../lib/format'
import { evaluateProp, PRESETS, PRESETS_UPDATED, suggestProp, withDefaults, type PropConfig } from '../lib/prop'
import { consistency, heldOverWeekend, maxLotForRoom, nearWeekend, newsViolations, payout, upcomingNews } from '../lib/propRules'
import { MIN_SIM_TRADES, riskLevels, simInput, simulate } from '../lib/propSim'
import { blankChallenge, STATUS_TEXT, summarize, type Challenge, type ChallengeStatus } from '../lib/challenges'
import { usePersistent } from '../lib/store'
import { BROKERS, isView, type InfoMap } from '../lib/accounts'
import { bridgeGet, type BridgeState } from '../lib/bridge'
import { PAIRS } from '../lib/forex'
import type { CalEvent } from '../lib/news'
import { partnerFor, type PartnerLinks } from '../lib/partners'
import type { Settings, Trade } from '../lib/types'

function Meter({ label, used, limit, kind, detail }: { label: string; used: number; limit: number; kind: 'loss' | 'gain'; detail: string }) {
  const ratio = limit > 0 ? Math.max(0, Math.min(1, used / limit)) : 0
  const level = kind === 'gain' ? 'ok' : ratio >= 0.85 ? 'crit' : ratio >= 0.6 ? 'warn' : 'ok'
  const flag = kind === 'loss' && level === 'crit' ? '⛔ Sát giới hạn' : kind === 'loss' && level === 'warn' ? '⚠ Cẩn thận' : ''
  return (
    <div className="meter-block">
      <div className="meter-head">
        <span>{label}</span>
        <span className="strong">{(ratio * 100).toFixed(0)}% {flag && <em className={`flag ${level}`}>{flag}</em>}</span>
      </div>
      <div className={`meter ${kind} ${level}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <div style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="muted small">{detail}</div>
    </div>
  )
}

const STATE_TIP: Record<string, string> = { crit: 'Đã vi phạm luật', ok: 'Đã đạt mục tiêu', warn: 'Sắp chạm giới hạn lỗ', on: 'Đang trong giới hạn' }

const STATE = {
  failed: { text: '⛔ Đã vi phạm luật', cls: 'state crit' },
  passed: { text: '✓ Đã đạt mục tiêu', cls: 'state ok' },
  active: { text: '● Đang trong giới hạn', cls: 'state' },
}

/** Khối theo dõi luật cho một tài khoản quỹ. Dùng ở trang Quỹ và ngay dưới tab tài khoản quỹ. */
export function FundPanel({ id: key, allTrades, settings, bridge, infos, links }: { id: string; allTrades: Trade[]; settings: Settings; bridge: BridgeState; infos: InfoMap; links?: PartnerLinks }) {
  const [configs, setConfigs] = usePersistent<Record<string, PropConfig>>('fx.props', {})
  const nowServer = Date.now() + settings.serverOffset * 3_600_000
  const cfg = withDefaults(configs[key] ?? suggestProp(infos[key]?.broker ?? '', infos[key]?.phase ?? '', bridge.accounts.find((a) => a.id === key)?.balance))
  const broker = (infos[key]?.broker ?? '').toLowerCase()
  // Đối tác có sẵn, hoặc đối tác IB tự thêm có tên khớp với broker của tài khoản.
  const partner = partnerFor(broker) ?? Object.entries(links ?? {}).map(([id, v]) => ({ id, name: v.name ?? id })).find((x) => broker && broker.includes(x.name.toLowerCase()))
  const link = partner && links?.[partner.id]
  const setCfg = (c: PropConfig) => setConfigs({ ...configs, [key]: c })
  const trades = allTrades.filter((t) => t.account === key)
  const account = bridge.accounts.find((a) => a.id === key) ?? null
  const set = (p: Partial<PropConfig>) => setCfg({ ...cfg, ...p, preset: 'preset' in p ? p.preset! : 'custom' })
  const ccy = account?.currency ?? infos[key]?.currency ?? settings.accountCcy
  const floating = account?.profit ?? 0
  const s = evaluateProp(trades, cfg, nowServer, floating)
  const drift = account ? account.balance - s.balance : 0

  const riskPerTrade = (s.balance * settings.riskPct) / 100

  // ---- Lịch tin (cho luật cấm giao dịch quanh tin), lot tối đa, luật thêm, mô phỏng, rút lợi nhuận.
  const [events, setEvents] = useState<CalEvent[]>([])
  useEffect(() => { if (bridge.online) bridgeGet<CalEvent[]>('/calendar').then(setEvents).catch(() => {}) }, [bridge.online])
  const [lotSymbol, setLotSymbol] = useState('XAUUSD')
  const [lotSl, setLotSl] = useState(50)
  const lev = account?.leverage ?? settings.leverage
  const lotDaily = maxLotForRoom(s.dailyRemaining, lotSymbol, lotSl, ccy, settings.quotes, lev)
  const lotTotal = maxLotForRoom(s.totalRemaining, lotSymbol, lotSl, ccy, settings.quotes, lev)
  const lotNormal = maxLotForRoom(riskPerTrade, lotSymbol, lotSl, ccy, settings.quotes, lev)
  const lotCands = [lotDaily, lotTotal].filter((x): x is number => x != null)
  const lotMax = lotCands.length ? Math.min(...lotCands) : null
  const cons = consistency(s.days, cfg.consistencyPct)
  const symbols = [...new Set([...trades.map((t) => t.symbol), ...(account?.positions.map((p) => p.symbol) ?? [])])]
  const upcoming = cfg.newsWindowMin > 0 ? upcomingNews(events, symbols.length ? symbols : ['XAUUSD', 'EURUSD'], Date.now()) : []
  const fromMs = cfg.startDate ? Date.parse(cfg.startDate + 'T00:00:00Z') : -Infinity
  const scoped = trades.filter((t) => t.closeTime >= fromMs)
  const newsHits = newsViolations(scoped, events, cfg.newsWindowMin, settings.serverOffset)
  const weekendHeld = cfg.noWeekend ? heldOverWeekend(scoped) : []
  const weekend = nearWeekend(nowServer)
  const po = payout(cfg, account?.balance ?? s.balance, nowServer)
  // Mô phỏng dùng R của mọi lệnh có SL trong Nhật ký của bạn (không tính tài khoản Only view): R không phụ thuộc cỡ tài khoản.
  const ownTrades = useMemo(() => allTrades.filter((t) => !isView(infos[t.account ?? ''])), [allTrades, infos])
  const sim = useMemo(() => {
    const input = simInput(ownTrades)
    if (input.rs.length < MIN_SIM_TRADES) return { n: input.rs.length, rows: [] }
    const peak = Math.max(cfg.accountSize, ...s.days.map((d) => d.endBalance))
    return { n: input.rs.length, rows: riskLevels(settings.riskPct).map((r) => simulate(input, cfg, { balance: s.balance, tradingDays: s.tradingDays, peak }, r, 2000, cfg.targetPct > 0 ? 60 : 30)) }
  }, [ownTrades, JSON.stringify(cfg), s.balance, s.tradingDays, settings.riskPct])
  const lossesLeft = riskPerTrade > 0 && Number.isFinite(s.room) ? Math.floor(s.room / riskPerTrade + 1e-9) : null

  return (
    <>
      {account ? (
        <p className="notice">
          ✓ Đang đọc trực tiếp tài khoản {account.login}: lãi/lỗ đang treo {signed(floating)} {ccy} đã được tính vào giới hạn.
          {Math.abs(drift) > 1 && ` ⚠ Số dư trên MT5 (${money(account.balance)}) lệch ${signed(drift)} so với Nhật ký; hãy đồng bộ lịch sử ở trang Tài khoản và kiểm tra vốn ban đầu, ngày bắt đầu.`}
        </p>
      ) : (
        <p className="warn">
          ⚠ Tài khoản này chưa kết nối MT5, nên chỉ tính trên lệnh đã đóng. Quỹ tính cả lãi/lỗ đang treo (equity), con số ở đây có thể lạc quan hơn thực tế khi bạn còn lệnh mở.
        </p>
      )}
      <p className="muted small">Thông số mẫu tổng hợp từ trang của quỹ và các trang đánh giá bên thứ ba (cập nhật {PRESETS_UPDATED}). Quỹ đổi luật thường xuyên và luật khác nhau theo cỡ tài khoản: hãy đối chiếu với điều khoản tài khoản của bạn và sửa lại nếu khác.</p>

      <section className="card">
        <div className="prop-form">
          <Field label="Chương trình">
            <select value={cfg.preset} onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value)
              if (p) setCfg({ ...cfg, ...p.rules, preset: p.id })
            }}>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="custom" disabled={cfg.preset !== 'custom'}>Tuỳ chỉnh</option>
            </select>
          </Field>
          <Field label={`Vốn ban đầu (${ccy})`}><Num value={cfg.accountSize} onChange={(v) => set({ accountSize: v, preset: cfg.preset })} min={0} /></Field>
          <Field label="Tính từ ngày" hint="Trống = mọi lệnh">
            <input type="date" value={cfg.startDate} onChange={(e) => set({ startDate: e.target.value, preset: cfg.preset })} />
          </Field>
          <Field label="Mục tiêu lãi (%)"><Num value={cfg.targetPct} onChange={(v) => set({ targetPct: v })} min={0} /></Field>
          <Field label="Lỗ tối đa trong ngày (%)" hint="0 = không áp dụng"><Num value={cfg.dailyLossPct} onChange={(v) => set({ dailyLossPct: v })} min={0} /></Field>
          <Field label="Lỗ ngày tính trên">
            <select value={cfg.dailyBase} onChange={(e) => set({ dailyBase: e.target.value as PropConfig['dailyBase'] })}>
              <option value="initial">Vốn ban đầu</option><option value="dayStart">Số dư đầu ngày</option>
            </select>
          </Field>
          <Field label="Lỗ tối đa tổng (%)"><Num value={cfg.maxLossPct} onChange={(v) => set({ maxLossPct: v })} min={0} /></Field>
          <Field label="Kiểu lỗ tổng">
            <select value={cfg.maxLossType} onChange={(e) => set({ maxLossType: e.target.value as PropConfig['maxLossType'] })}>
              <option value="static">Cố định từ vốn ban đầu</option><option value="trailing">Trailing theo đỉnh cuối ngày</option>
            </select>
          </Field>
          <Field label="Số ngày giao dịch tối thiểu"><Num value={cfg.minDays} onChange={(v) => set({ minDays: v })} min={0} /></Field>
        </div>
        <h4 className="form-sub">Luật thêm</h4>
        <div className="prop-form">
          <Field label="Luật nhất quán (%)" hint="Lãi ngày tốt nhất ≤ X% tổng lãi. 0 = không áp dụng"><Num value={cfg.consistencyPct} onChange={(v) => set({ consistencyPct: v })} min={0} /></Field>
          <Field label="Cấm giao dịch quanh tin (phút)" hint="Trước và sau tin mạnh. 0 = không áp dụng"><Num value={cfg.newsWindowMin} onChange={(v) => set({ newsWindowMin: v })} min={0} /></Field>
          <Field group label="Giữ lệnh qua cuối tuần">
            <div className="seg">
              <button className={!cfg.noWeekend ? 'active' : ''} aria-pressed={!cfg.noWeekend} onClick={() => set({ noWeekend: false })}>Được phép</button>
              <button className={cfg.noWeekend ? 'active' : ''} aria-pressed={cfg.noWeekend} onClick={() => set({ noWeekend: true })}>Cấm</button>
            </div>
          </Field>
        </div>
        <h4 className="form-sub">Rút lợi nhuận <span className="muted small">(tài khoản đã cấp vốn)</span></h4>
        <div className="prop-form">
          <Field label="Bạn nhận (%)" hint="0 = chưa đặt"><Num value={cfg.profitSplitPct} onChange={(v) => set({ profitSplitPct: v })} min={0} /></Field>
          <Field label="Chu kỳ rút (ngày)"><Num value={cfg.payoutDays} onChange={(v) => set({ payoutDays: v })} min={0} /></Field>
          <Field label="Trần mỗi lần rút (% vốn)" hint="0 = không trần"><Num value={cfg.payoutCapPct} onChange={(v) => set({ payoutCapPct: v })} min={0} /></Field>
          <Field label="Lần rút gần nhất" hint="Trống = tính từ ngày bắt đầu"><input type="date" value={cfg.lastPayout} onChange={(e) => set({ lastPayout: e.target.value, preset: cfg.preset })} /></Field>
        </div>
      </section>

      <div className="tiles wide">
        <Tile label="Trạng thái" value={<span className={STATE[s.state].cls}>{STATE[s.state].text}</span>}
          sub={s.breaches.length ? s.breaches[0] + (s.breaches.length > 1 ? ` (+${s.breaches.length - 1})` : '') : `Số dư ${money(s.balance, ccy)} · ${signed(s.pnl)} từ đầu`} />
        <Tile label="Còn được lỗ hôm nay" value={Number.isFinite(s.room) ? money(s.room, ccy) : 'Không giới hạn'}
          sub={lossesLeft == null ? `Ngày máy chủ ${s.today}` : `≈ ${lossesLeft} lệnh thua ở mức rủi ro ${settings.riskPct}% (${money(riskPerTrade)})`} />
        <Tile label="Ngày giao dịch" value={cfg.minDays > 0 ? `${s.tradingDays} / ${cfg.minDays}` : String(s.tradingDays)}
          sub={s.daysLeftToMin > 0 ? `Cần thêm ${s.daysLeftToMin} ngày` : 'Đã đủ số ngày tối thiểu'} />
      </div>

      <section className="card meters">
        {cfg.targetPct > 0 && (
          <Meter kind="gain" label="Tiến độ mục tiêu lãi" used={Math.max(0, s.pnl)} limit={s.target}
            detail={`${signed(s.pnl)} / ${money(s.target, ccy)} · còn thiếu ${money(Math.max(0, s.target - s.pnl), ccy)}`} />
        )}
        {cfg.dailyLossPct > 0 && (
          <Meter kind="loss" label={`Lỗ hôm nay (${s.today})`} used={s.dailyUsed} limit={s.dailyLimit}
            detail={`Đã lỗ ${money(s.dailyUsed)} / giới hạn ${money(s.dailyLimit, ccy)} · còn ${money(s.dailyRemaining, ccy)}`} />
        )}
        {cfg.maxLossPct > 0 && (
          <Meter kind="loss" label="Lỗ tổng" used={s.maxLossUsed} limit={s.maxLossLimit}
            detail={`Sàn số dư ${money(s.floor, ccy)} · còn cách ${money(s.totalRemaining, ccy)}`} />
        )}
      </section>

      <section className="card">
        <h3>Còn vào được bao nhiêu lot?</h3>
        <p className="muted small">Lot tối đa để nếu lệnh chạm stop loss, bạn vẫn chưa vượt giới hạn lỗ của quỹ (đã tính lệnh đang treo).</p>
        <div className="prop-form">
          <Field label="Cặp"><select value={lotSymbol} onChange={(e) => setLotSymbol(e.target.value)}>{PAIRS.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Stop loss (pip)" tone="sl"><Num value={lotSl} onChange={setLotSl} min={0} /></Field>
        </div>
        {!(lotSl > 0) ? <p className="warn">⚠ Nhập stop loss để tính. Không có stop loss thì không có giới hạn an toàn nào.</p> : (
          <div className="lot-rows">
            {lotDaily != null && <div><span>Theo lỗ hôm nay (còn {money(s.dailyRemaining, ccy)})</span><strong>{lotDaily.toFixed(2)} lot</strong></div>}
            {lotTotal != null && <div><span>Theo lỗ tổng (còn {money(s.totalRemaining, ccy)})</span><strong>{lotTotal.toFixed(2)} lot</strong></div>}
            {lotNormal != null && <div className="muted"><span>Theo mức rủi ro thường ngày {settings.riskPct}% ({money(riskPerTrade, ccy)})</span><strong>{lotNormal.toFixed(2)} lot</strong></div>}
            {lotMax != null && <div className="lot-max"><span>Tối đa được vào</span><strong>{lotMax.toFixed(2)} lot</strong></div>}
            {lotMax === 0 && <p className="warn">⛔ Với stop loss này, vào lệnh nhỏ nhất (0.01 lot) cũng có thể vượt giới hạn. Nên dừng giao dịch hôm nay.</p>}
            {lotMax != null && lotNormal != null && lotMax > 0 && lotNormal < lotMax && <p className="muted small">Nên vào theo mức rủi ro thường ngày ({lotNormal.toFixed(2)} lot). Mức tối đa chỉ là giới hạn, không phải gợi ý: vào sát mức tối đa thì một lệnh thua là hết đường.</p>}
          </div>
        )}
      </section>

      <section className="card">
        <h3>Luật khác</h3>
        {!cons && !(cfg.newsWindowMin > 0) && !cfg.noWeekend && <p className="muted small">Quỹ này chưa bật luật nhất quán, cấm giao dịch quanh tin hay cấm giữ lệnh cuối tuần. Nếu điều khoản của quỹ có, bật ở phần "Luật thêm" bên trên.</p>}
        {cons && (
          <div className="rule-block">
            <div className="meter-head">
              <span>Luật nhất quán: ngày tốt nhất ≤ {cons.limitPct}% tổng lãi</span>
              <span className="strong">{cons.totalProfit > 0 ? `${(cons.share * 100).toFixed(0)}% / tối đa ${cons.limitPct}%` : 'Chưa áp dụng'} {cons.totalProfit > 0 && <em className={`flag ${cons.ok ? 'ok' : 'crit'}`}>{cons.ok ? '✓ Đạt' : '⛔ Vượt luật'}</em>}</span>
            </div>
            {cons.totalProfit > 0 && (
              <div className={`meter loss ${cons.ok ? (cons.share * 100 >= cons.limitPct * 0.85 ? 'warn' : 'ok') : 'crit'}`} role="meter" aria-label="Luật nhất quán" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cons.share * 100)}>
                <div style={{ width: `${Math.min(100, cons.share * 100)}%` }} />
                <i className="meter-limit" style={{ left: `${cons.limitPct}%` }} aria-hidden="true" />
              </div>
            )}
            <div className="muted small">{cons.totalProfit <= 0 ? 'Chưa có lãi nên chưa áp dụng.' : `Ngày ${cons.bestDate} lãi ${money(cons.bestDay, ccy)} = ${(cons.share * 100).toFixed(0)}% tổng lãi ${money(cons.totalProfit, ccy)}.${cons.ok ? '' : ` Cần lãi thêm khoảng ${money(cons.needMore, ccy)} ở những ngày khác (mỗi ngày không vượt ${money(cons.bestDay, ccy)}) mới đạt luật.`}`}</div>
          </div>
        )}
        {cfg.newsWindowMin > 0 && (
          <div className="rule-block">
            <strong>Cấm giao dịch {cfg.newsWindowMin} phút trước và sau tin mạnh</strong>
            {!bridge.online && <p className="muted small">Cần bridge để đọc lịch kinh tế.</p>}
            {upcoming.length > 0 ? (
              <ul className="news-list">{upcoming.map((e) => { const at = Date.parse(e.date); const f = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); return <li key={e.title + e.date}>⚠ <b>{e.currency} · {e.title}</b> lúc {f(at)}: không mở hay đóng lệnh {e.currency} (kể cả vàng nếu là USD) từ {f(at - cfg.newsWindowMin * 60_000)} đến {f(at + cfg.newsWindowMin * 60_000)}.</li> })}</ul>
            ) : bridge.online && <p className="muted small">Không có tin mạnh nào trong 2 giờ tới cho các cặp bạn giao dịch.</p>}
            {newsHits.length > 0 && <p className="warn">⛔ {newsHits.length} lệnh tuần này mở hoặc đóng sát tin: {newsHits.slice(0, 3).map((h) => `${h.trade!.symbol} ${h.what === 'open' ? 'mở' : 'đóng'} quanh ${h.event.title}`).join('; ')}{newsHits.length > 3 ? '…' : ''}. Kiểm tra điều khoản: có quỹ huỷ lãi của lệnh này, có quỹ coi là vi phạm.</p>}
            <p className="muted small">Lịch kinh tế chỉ có tuần hiện tại, nên chỉ kiểm tra được lệnh trong tuần này.</p>
          </div>
        )}
        {cfg.noWeekend && (
          <div className="rule-block">
            <strong>Cấm giữ lệnh qua cuối tuần</strong>
            {weekend.near && (account?.positions.length ?? 0) > 0
              ? <p className="warn">⚠ Sắp đóng cửa cuối tuần {weekend.hoursLeft > 0 ? `(còn khoảng ${weekend.hoursLeft.toFixed(1)} giờ)` : ''} mà còn {account!.positions.length} lệnh mở. Đóng hết trước khi thị trường đóng cửa thứ Sáu.</p>
              : <p className="muted small">{weekend.near ? 'Sắp tới cuối tuần, hiện không có lệnh mở.' : 'App nhắc từ 18:00 thứ Sáu (giờ máy chủ) nếu còn lệnh mở.'}</p>}
            {weekendHeld.length > 0 && <p className="warn">⛔ {weekendHeld.length} lệnh đã giữ qua cuối tuần: {weekendHeld.slice(0, 3).map((t) => `${t.symbol} mở ${new Date(t.openTime).toISOString().slice(0, 10)}`).join('; ')}{weekendHeld.length > 3 ? '…' : ''}.</p>}
          </div>
        )}
      </section>

      {s.state === 'active' && (
        <section className="card">
          <h3>{cfg.targetPct > 0 ? 'Khả năng qua vòng' : 'Khả năng chạm giới hạn lỗ trong 30 ngày'}</h3>
          {sim.rows.length === 0 ? (
            <p className="muted">Cần ít nhất {MIN_SIM_TRADES} lệnh có stop loss trong Nhật ký để mô phỏng (đang có {sim.n}).</p>
          ) : (
            <>
              <p className="muted small">App lấy {sim.n} lệnh có stop loss của bạn, giả lập 2.000 lần tiếp tục giao dịch theo đúng cách đó từ trạng thái hiện tại, với từng mức rủi ro mỗi lệnh{cfg.targetPct > 0 ? ' (tối đa 60 ngày giao dịch)' : ''}.</p>
              <div className="table-wrap">
                <table className="sim-table">
                  <thead><tr><th>Rủi ro mỗi lệnh</th>{cfg.targetPct > 0 && <th className="num">Qua vòng</th>}<th className="num">{cfg.targetPct > 0 ? 'Rớt' : 'Chạm giới hạn lỗ'}</th>{cfg.targetPct > 0 && <th className="num">Chưa xong</th>}{cfg.targetPct > 0 && <th className="num">Thường mất</th>}<th /></tr></thead>
                  <tbody>
                    {sim.rows.map((r) => {
                      const best = cfg.targetPct > 0 && r.pass === Math.max(...sim.rows.map((x) => x.pass))
                      return (
                        <tr key={r.riskPct} className={r.riskPct === settings.riskPct ? 'current' : ''}>
                          <td>{r.riskPct}%{r.riskPct === settings.riskPct && <span className="chip">đang dùng</span>}</td>
                          {cfg.targetPct > 0 && <td className="num strong pos">{Math.round(r.pass * 100)}%</td>}
                          <td className="num strong neg">{Math.round(r.fail * 100)}%</td>
                          {cfg.targetPct > 0 && <td className="num">{Math.round(r.open * 100)}%</td>}
                          {cfg.targetPct > 0 && <td className="num">{r.medianDays != null ? `${r.medianDays} ngày` : '–'}</td>}
                          <td>{best && <span className="chip ok-chip">khả năng qua cao nhất</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted small">Chỉ là mô phỏng từ lịch sử của bạn, không phải dự đoán. Không thấy lãi/lỗ giữa lệnh nên hơi lạc quan với giới hạn lỗ ngày. Ít lệnh thì con số dao động nhiều.</p>
            </>
          )}
        </section>
      )}

      {po && (
        <section className="card">
          <h3>Rút lợi nhuận</h3>
          <div className="tiles wide">
            <Tile tone={po.profit} label="Lãi trên vốn ban đầu" value={money(po.profit, ccy)} sub={`Bạn nhận ${Math.round(po.share * 100)}%${po.capped ? ` · trần ${cfg.payoutCapPct}% vốn mỗi lần rút` : ''}`} />
            <Tile tone={po.withdrawable > 0 ? 1 : 0} label="Rút được lúc này khoảng" value={money(po.withdrawable, ccy)} sub={po.capped ? 'Phần vượt trần để lại cho lần sau (một số quỹ huỷ phần vượt, xem điều khoản)' : 'Trước phí rút và chênh lệch tỷ giá'} />
            <Tile label="Ngày rút tiếp theo" value={po.nextDate ?? 'Chưa rõ'} sub={po.daysToNext != null ? (po.daysToNext === 0 ? 'Đã tới hạn rút' : `Còn ${po.daysToNext} ngày`) : 'Đặt chu kỳ rút và ngày rút gần nhất ở trên'} />
          </div>
          <p className="muted small">Rút xong thì đặt lại "Lần rút gần nhất" và ghi khoản rút vào Lịch sử thi quỹ ở cuối trang để tính lãi thật.</p>
        </section>
      )}

      {partner && link?.url && (s.state !== 'active') && (
        <section className="card partner-cta">
          <div>
            <strong>{s.state === 'failed' ? `Thử lại với ${partner.name}?` : `Qua vòng rồi. Mua thêm tài khoản ${partner.name}?`}</strong>
            <p className="muted small">{[link.pitch, link.code ? `Mã giảm giá: ${link.code}` : ''].filter(Boolean).join(' · ') || 'Mua qua link giới thiệu của cộng đồng.'}</p>
          </div>
          <a className="button primary" href={link.url} target="_blank" rel="noopener noreferrer">{link.cta || `Mở ${partner.name}`}</a>
        </section>
      )}

      <section className="card">
        <h3>Theo từng ngày</h3>
        {s.days.length === 0 ? (
          <p className="muted">Chưa có lệnh nào trong khoảng thời gian này. Import lệnh ở trang Nhật ký.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Ngày (máy chủ)</th><th className="num">Lệnh</th><th className="num">Lãi/lỗ ngày</th><th className="num">Giới hạn lỗ ngày</th><th className="num">Số dư cuối ngày</th><th className="num">Sàn số dư</th><th>Vi phạm</th></tr>
              </thead>
              <tbody>
                {[...s.days].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td className="num">{d.trades}</td>
                    <td className="num strong"><span className={d.net > 0 ? 'pip pos' : d.net < 0 ? 'pip neg' : 'pip'} />{signed(d.net)}</td>
                    <td className="num">{d.dailyLimit > 0 ? money(d.dailyLimit) : '–'}</td>
                    <td className="num">{money(d.endBalance)}</td>
                    <td className="num">{money(d.floor)}</td>
                    <td>{d.dailyBreach || d.floorBreach ? `⛔ ${[d.dailyBreach && 'Lỗ ngày', d.floorBreach && 'Lỗ tổng'].filter(Boolean).join(', ')}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

/** Lịch sử thi quỹ: mỗi lần mua một dòng, kèm các lần rút; tổng hợp lãi/lỗ thật theo từng quỹ. */
function ChallengeHistory({ propIds, infos }: { propIds: string[]; infos: InfoMap }) {
  const [list, setList] = usePersistent<Challenge[]>('fx.challenges', [])
  const [form, setForm] = useState<Challenge | null>(null)
  const [payFor, setPayFor] = useState<string | null>(null)
  const [pay, setPay] = useState({ date: new Date().toISOString().slice(0, 10), amount: NaN })
  const { firms, total } = summarize(list)
  const firmNames = [...new Set([...BROKERS, ...list.map((c) => c.firm)])]
  const upd = (id: string, p: Partial<Challenge>) => setList(list.map((c) => (c.id === id ? { ...c, ...p } : c)))
  const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`)
  return (
    <section className="card challenge-history">
      <div className="card-head">
        <h3>Lịch sử thi quỹ</h3>
        <button className="primary" onClick={() => setForm(blankChallenge())}>+ Thêm lần mua</button>
      </div>
      <p className="muted small">Ghi mỗi lần mua challenge hoặc tài khoản instant, kết quả và các lần rút lợi nhuận, để biết thật sự lãi hay lỗ khi tính cả phí.</p>

      {form && (
        <div className="challenge-form">
          <div className="prop-form">
            <Field label="Quỹ"><input list="ch-firms" value={form.firm} placeholder="FTMO, TenTrade…" onChange={(e) => setForm({ ...form, firm: e.target.value })} /><datalist id="ch-firms">{firmNames.map((f) => <option key={f} value={f} />)}</datalist></Field>
            <Field label="Chương trình"><input list="ch-programs" value={form.program} placeholder="2-Step, Instant…" onChange={(e) => setForm({ ...form, program: e.target.value })} /><datalist id="ch-programs">{PRESETS.map((p) => <option key={p.id} value={p.name} />)}</datalist></Field>
            <Field label="Cỡ tài khoản"><Num value={form.size} onChange={(v) => setForm({ ...form, size: v })} min={0} /></Field>
            <Field label="Phí mua (USD)"><Num value={form.fee} onChange={(v) => setForm({ ...form, fee: v })} min={0} /></Field>
            <Field label="Ngày mua"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Trạng thái"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ChallengeStatus })}>{(Object.keys(STATUS_TEXT) as ChallengeStatus[]).map((k) => <option key={k} value={k}>{STATUS_TEXT[k]}</option>)}</select></Field>
            <Field label="Tài khoản trong app" hint="Không bắt buộc"><select value={form.account ?? ''} onChange={(e) => setForm({ ...form, account: e.target.value || undefined })}><option value="">Không gắn</option>{propIds.map((id) => <option key={id} value={id}>{infos[id]?.label ?? id}</option>)}</select></Field>
            <Field label="Ghi chú"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
          <div className="actions">
            <button className="primary" disabled={!form.firm.trim()} onClick={() => { setList(list.some((c) => c.id === form.id) ? list.map((c) => (c.id === form.id ? form : c)) : [form, ...list]); setForm(null) }}>Lưu</button>
            <button className="ghost" onClick={() => setForm(null)}>Huỷ</button>
          </div>
        </div>
      )}

      {list.length === 0 ? <p className="muted">Chưa có lần mua nào.</p> : (
        <>
          <div className="tiles wide">
            <Tile label="Đã mua" value={`${total.bought} lần`} sub={`${total.passed} qua · ${total.failed} rớt · ${total.active} đang thi`} />
            <Tile label="Tỷ lệ qua" value={pct(total.passRate)} sub="Trên các lần đã có kết quả" />
            <Tile tone="neg" label="Tổng phí" value={money(total.fees, 'USD')} sub="Không tính lần được hoàn phí" />
            <Tile tone={total.net} label="Lãi/lỗ thật" value={`${signed(total.net)} USD`} sub={`Đã rút ${money(total.payouts, 'USD')} trừ phí`} />
          </div>
          {firms.length > 1 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Quỹ</th><th className="num">Mua</th><th className="num">Qua</th><th className="num">Rớt</th><th className="num">Tỷ lệ qua</th><th className="num">Phí</th><th className="num">Đã rút</th><th className="num">Lãi/lỗ thật</th></tr></thead>
                <tbody>{firms.map((f) => <tr key={f.firm}><td className="strong">{f.firm}</td><td className="num">{f.bought}</td><td className="num">{f.passed}</td><td className="num">{f.failed}</td><td className="num">{pct(f.passRate)}</td><td className="num">{money(f.fees)}</td><td className="num">{money(f.payouts)}</td><td className="num strong"><span className={f.net > 0 ? 'pip pos' : f.net < 0 ? 'pip neg' : 'pip'} />{signed(f.net)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ngày mua</th><th>Quỹ · chương trình</th><th className="num">Cỡ</th><th className="num">Phí</th><th>Trạng thái</th><th className="num">Đã rút</th><th /></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">{c.date}</td>
                    <td><strong>{c.firm}</strong>{c.program && <div className="muted small">{c.program}</div>}{c.note && <div className="muted small">{c.note}</div>}</td>
                    <td className="num">{money(c.size, '', 0)}</td>
                    <td className="num">{money(c.fee)}</td>
                    <td><select aria-label="Trạng thái" value={c.status} onChange={(e) => upd(c.id, { status: e.target.value as ChallengeStatus })}>{(Object.keys(STATUS_TEXT) as ChallengeStatus[]).map((k) => <option key={k} value={k}>{STATUS_TEXT[k]}</option>)}</select></td>
                    <td className="num">{money(c.payouts.reduce((s, p) => s + p.amount, 0))}{c.payouts.length > 0 && <div className="muted small">{c.payouts.length} lần</div>}</td>
                    <td className="nowrap">
                      {payFor === c.id ? (
                        <span className="inline-pay">
                          <input type="date" aria-label="Ngày rút" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
                          <Num value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} min={0} />
                          <button className="primary mini" disabled={!(pay.amount > 0)} onClick={() => { upd(c.id, { payouts: [...c.payouts, { date: pay.date, amount: pay.amount }] }); setPayFor(null); setPay({ ...pay, amount: NaN }) }}>Lưu</button>
                          <button className="ghost mini" onClick={() => setPayFor(null)}>Huỷ</button>
                        </span>
                      ) : (
                        <>
                          <button className="ghost mini" onClick={() => setPayFor(c.id)}>+ Lần rút</button>
                          <button className="ghost mini" onClick={() => setForm(c)}>Sửa</button>
                          <button className="ghost mini danger" onClick={async () => { if (await ask(`Xoá lần mua ${c.firm} ngày ${c.date}?`, 'Xoá', true)) setList(list.filter((x) => x.id !== c.id)) }}>Xoá</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

export default function Prop({ trades: allTrades, settings, bridge, infos, goAccounts, links }: { trades: Trade[]; settings: Settings; bridge: BridgeState; infos: InfoMap; goAccounts: () => void; links?: PartnerLinks }) {
  // Chỉ tài khoản có vai trò "Quỹ"; mỗi tài khoản một bộ luật riêng.
  const [configs] = usePersistent<Record<string, PropConfig>>('fx.props', {})
  const propIds = Object.keys(infos).filter((id) => infos[id].role === 'prop')
  const [picked, setPicked] = useState<string | null>(null)
  const key = picked && propIds.includes(picked) ? picked : propIds[0]
  const nowServer = Date.now() + settings.serverOffset * 3_600_000
  const configFor = (id: string) => withDefaults(configs[id] ?? suggestProp(infos[id]?.broker ?? '', infos[id]?.phase ?? '', bridge.accounts.find((a) => a.id === id)?.balance))
  // Trạng thái từng quỹ, để hiện chấm màu trên tab.
  const states = useMemo(() => Object.fromEntries(propIds.map((id) => {
    const live = bridge.accounts.find((a) => a.id === id)
    const st = evaluateProp(allTrades.filter((t) => t.account === id), configFor(id), nowServer, live?.profit ?? 0)
    const tight = Number.isFinite(st.room) && st.dailyLimit > 0 && st.room < st.dailyLimit * 0.4
    return [id, st.state === 'failed' ? 'crit' : st.state === 'passed' ? 'ok' : tight ? 'warn' : 'on']
  })), [propIds.join(), allTrades, configs, bridge.accounts, Math.floor(nowServer / 60000)])

  if (!key) {
    return (
      <>
        <h1>Quỹ</h1>
        <section className="card empty">
          <p>Chưa có tài khoản quỹ nào.</p>
          <p className="muted small">Ở trang Tài khoản, mở tab của tài khoản quỹ và đặt <strong>Vai trò</strong> là “Quỹ”, hoặc thêm tài khoản mới với vai trò đó.</p>
          <button className="primary" onClick={goAccounts}>Sang trang Tài khoản</button>
        </section>
        <ChallengeHistory propIds={propIds} infos={infos} />
      </>
    )
  }

  return (
    <>
      <h1>Quỹ</h1>
      <div className="tabs" role="tablist" aria-label="Tài khoản quỹ">
        {propIds.map((id) => (
          <button key={id} role="tab" aria-selected={id === key} className={id === key ? 'tab active' : 'tab'} onClick={() => setPicked(id)}>
            <span className={`led st-${states[id]}`} title={STATE_TIP[states[id]]} /> {infos[id].label}
            {(infos[id].broker || infos[id].phase) && <small>{[infos[id].broker, infos[id].phase].filter(Boolean).join(' · ')}</small>}
          </button>
        ))}
      </div>
      <FundPanel key={key} id={key} allTrades={allTrades} settings={settings} bridge={bridge} infos={infos} links={links} />
      <ChallengeHistory propIds={propIds} infos={infos} />
    </>
  )
}
