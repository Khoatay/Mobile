import { useMemo, useRef, useState } from 'react'
import { Field, Num } from '../components/Field'
import { demoTrades } from '../lib/demo'
import { normalizeSymbol, PAIRS } from '../lib/forex'
import { signed } from '../lib/format'
import { CSV_TEMPLATE, decodeFile, fmtServerTime, parseReport, parseTime, toCsv } from '../lib/parse'
import { rMultiple } from '../lib/stats'
import { download, mergeTrades } from '../lib/store'
import { netOf, type Settings, type Side, type Trade } from '../lib/types'

interface Props {
  trades: Trade[]
  setTrades: (t: Trade[]) => void
  settings: Settings
  patch: (p: Partial<Settings>) => void
}

const FORMAT_NAME = { mt5: 'MT5', mt4: 'MT4', csv: 'CSV', unknown: 'không rõ' }
const PAGE = 100

const blank = { symbol: 'EURUSD', side: 'buy' as Side, volume: 0.1, openTime: '', closeTime: '', openPrice: NaN, closePrice: NaN, sl: NaN, profit: NaN }

export default function Journal({ trades, setTrades, settings, patch }: Props) {
  const [messages, setMessages] = useState<{ ok: boolean; text: string }[]>([])
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [form, setForm] = useState(blank)
  const fileInput = useRef<HTMLInputElement>(null)

  async function importFiles(files: FileList | File[]) {
    let all = trades
    const msgs: typeof messages = []
    for (const f of Array.from(files)) {
      try {
        const res = parseReport(decodeFile(await f.arrayBuffer()))
        if (res.trades.length === 0) {
          msgs.push({ ok: false, text: `${f.name}: ${res.warnings.join(' ') || 'không có lệnh nào.'}` })
          continue
        }
        const merged = mergeTrades(all, res.trades)
        all = merged.trades
        const dup = res.trades.length - merged.added
        msgs.push({
          ok: true,
          text: `${f.name} (${FORMAT_NAME[res.format]}): thêm ${merged.added} lệnh${dup ? `, bỏ ${dup} lệnh đã có` : ''}. ${res.warnings.join(' ')}`,
        })
      } catch {
        msgs.push({ ok: false, text: `${f.name}: không đọc được file.` })
      }
    }
    setTrades(all)
    setMessages(msgs)
  }

  function addManual() {
    const openTime = parseTime(form.openTime.replace('T', ' '))
    const closeTime = parseTime(form.closeTime.replace('T', ' '))
    if (![openTime, closeTime, form.openPrice, form.closePrice, form.profit, form.volume].every(Number.isFinite)) {
      setMessages([{ ok: false, text: 'Nhập tay: cần đủ thời gian mở/đóng, giá mở/đóng, khối lượng và lãi/lỗ.' }])
      return
    }
    const ticket = `M${Date.now()}`
    setTrades([...trades, {
      id: `manual:${ticket}`, ticket, symbol: normalizeSymbol(form.symbol), side: form.side, volume: form.volume,
      openTime, closeTime, openPrice: form.openPrice, closePrice: form.closePrice,
      sl: Number.isFinite(form.sl) ? form.sl : 0, tp: 0, commission: 0, swap: 0, profit: form.profit, source: 'manual',
    }])
    setForm(blank)
    setMessages([{ ok: true, text: 'Đã thêm 1 lệnh nhập tay.' }])
  }

  const update = (id: string, p: Partial<Trade>) => setTrades(trades.map((t) => (t.id === id ? { ...t, ...p } : t)))

  const rows = useMemo(() => {
    const f = filter.trim().toUpperCase()
    return trades
      .filter((t) => !f || t.symbol.includes(f) || (t.setup ?? '').toUpperCase().includes(f) || (t.note ?? '').toUpperCase().includes(f))
      .sort((a, b) => b.closeTime - a.closeTime)
  }, [trades, filter])

  return (
    <>
      <h1>Nhật ký lệnh</h1>

      <section
        className={dragging ? 'card drop dragging' : 'card drop'}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); importFiles(e.dataTransfer.files) }}
      >
        <div>
          <strong>Kéo thả file lịch sử lệnh vào đây</strong>
          <p className="muted small">
            MT5: tab History → chuột phải → Report → HTML. MT4: tab Account History → chuột phải → Save as Report. Hoặc file CSV theo mẫu.
          </p>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => fileInput.current?.click()}>Chọn file…</button>
          <button onClick={() => { const m = mergeTrades(trades, demoTrades()); setTrades(m.trades); setMessages([{ ok: true, text: `Đã nạp ${m.added} lệnh mẫu.` }]) }}>Nạp dữ liệu mẫu</button>
          <button className="ghost" onClick={() => download('mau-nhat-ky.csv', CSV_TEMPLATE, 'text/csv')}>Tải CSV mẫu</button>
        </div>
        <input ref={fileInput} type="file" multiple accept=".html,.htm,.csv,.txt" hidden
          onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = '' }} />
      </section>

      {messages.map((m, i) => <p key={i} className={m.ok ? 'notice' : 'notice bad'}>{m.ok ? '✓' : '⚠'} {m.text}</p>)}

      <details className="card">
        <summary>Thêm lệnh bằng tay</summary>
        <div className="manual">
          <Field label="Cặp tiền">
            <input list="pairs" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
            <datalist id="pairs">{PAIRS.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Chiều">
            <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as Side })}>
              <option value="buy">Buy</option><option value="sell">Sell</option>
            </select>
          </Field>
          <Field label="Khối lượng (lot)"><Num value={form.volume} onChange={(v) => setForm({ ...form, volume: v })} step={0.01} /></Field>
          <Field label="Mở lúc"><input type="datetime-local" value={form.openTime} onChange={(e) => setForm({ ...form, openTime: e.target.value })} /></Field>
          <Field label="Đóng lúc"><input type="datetime-local" value={form.closeTime} onChange={(e) => setForm({ ...form, closeTime: e.target.value })} /></Field>
          <Field label="Giá mở"><Num value={form.openPrice} onChange={(v) => setForm({ ...form, openPrice: v })} /></Field>
          <Field label="Giá đóng"><Num value={form.closePrice} onChange={(v) => setForm({ ...form, closePrice: v })} /></Field>
          <Field label="Stop loss"><Num value={form.sl} onChange={(v) => setForm({ ...form, sl: v })} /></Field>
          <Field label={`Lãi/lỗ ròng (${settings.accountCcy})`}><Num value={form.profit} onChange={(v) => setForm({ ...form, profit: v })} /></Field>
          <button className="primary" onClick={addManual}>Thêm lệnh</button>
        </div>
      </details>

      <section className="card">
        <div className="card-head">
          <h3>{rows.length} lệnh đã đóng</h3>
          <div className="actions">
            <input className="search" placeholder="Lọc theo cặp, setup, ghi chú" value={filter} onChange={(e) => { setFilter(e.target.value); setShown(PAGE) }} />
            <label className="inline">Múi giờ máy chủ: UTC+
              <input className="tiny" type="number" value={settings.serverOffset} onChange={(e) => patch({ serverOffset: e.target.valueAsNumber || 0 })} />
            </label>
            <button disabled={!trades.length} onClick={() => download('nhat-ky-lenh.csv', toCsv(trades), 'text/csv')}>Xuất CSV</button>
            <button className="ghost danger" disabled={!trades.length}
              onClick={() => { if (confirm(`Xoá toàn bộ ${trades.length} lệnh? Không hoàn tác được.`)) { setTrades([]); setMessages([]) } }}>Xoá tất cả</button>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="muted">Chưa có lệnh nào. Hãy import file hoặc nạp dữ liệu mẫu để xem thử.</p>
        ) : (
          <div className="table-wrap">
            <table className="trades">
              <thead>
                <tr>
                  <th>Đóng lúc</th><th>Cặp</th><th>Chiều</th><th className="num">Lot</th><th className="num">Giá mở</th>
                  <th className="num">Giá đóng</th><th className="num">Lãi/lỗ ròng</th><th className="num">R</th><th>Setup</th><th>Ghi chú</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((t) => {
                  const r = rMultiple(t)
                  const net = netOf(t)
                  return (
                    <tr key={t.id}>
                      <td className="nowrap" title={`Mở: ${fmtServerTime(t.openTime)} (giờ máy chủ)`}>{fmtServerTime(t.closeTime).slice(0, 16)}</td>
                      <td>{t.symbol}</td>
                      <td>{t.side === 'buy' ? 'Buy' : 'Sell'}</td>
                      <td className="num">{t.volume.toFixed(2)}</td>
                      <td className="num">{t.openPrice}</td>
                      <td className="num">{t.closePrice}</td>
                      <td className="num strong"><span className={net > 0 ? 'pip pos' : net < 0 ? 'pip neg' : 'pip'} />{signed(net)}</td>
                      <td className="num">{r == null ? '–' : signed(r) + 'R'}</td>
                      <td><input className="cell" defaultValue={t.setup ?? ''} placeholder="…" onBlur={(e) => e.target.value !== (t.setup ?? '') && update(t.id, { setup: e.target.value })} /></td>
                      <td><input className="cell wide" defaultValue={t.note ?? ''} placeholder="…" onBlur={(e) => e.target.value !== (t.note ?? '') && update(t.id, { note: e.target.value })} /></td>
                      <td><button className="ghost icon" aria-label={`Xoá lệnh ${t.ticket}`} onClick={() => setTrades(trades.filter((x) => x.id !== t.id))}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > shown && <button onClick={() => setShown(shown + PAGE)}>Xem thêm {Math.min(PAGE, rows.length - shown)} lệnh</button>}
        <p className="muted small">Thời gian hiển thị theo giờ máy chủ của broker. R = biến động giá chia khoảng cách stop loss; để trống nếu lệnh không có SL hoặc SL đã dời qua điểm vào.</p>
      </section>
    </>
  )
}
