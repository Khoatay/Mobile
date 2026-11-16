import { useMemo, useState } from 'react'
import BarTable from '../components/BarTable'
import { Field, Num, Tile } from '../components/Field'
import { bridgeGet, type BridgeState, type Mt5Deal } from '../lib/bridge'
import { money, pct, signed } from '../lib/format'
import { balanceDealsToEntries, CATEGORIES, categoryLabel, ledgerCsv, summarize, type Flow, type LedgerEntry } from '../lib/ledger'
import { download, usePersistent } from '../lib/store'
import type { InfoMap } from '../lib/accounts'
import type { Settings } from '../lib/types'

const today = () => new Date().toISOString().slice(0, 10)

export default function Ledger({ bridge, settings, labels, infos }: { bridge: BridgeState; settings: Settings; labels: Record<string, string>; infos: InfoMap }) {
  const [entries, setEntries] = usePersistent<LedgerEntry[]>('fx.ledger', [])
  const [flow, setFlow] = useState<Flow>('out')
  const [category, setCategory] = useState(CATEGORIES.out[0].id)
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState(NaN)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const ccy = settings.accountCcy

  // Tiền còn nằm trong tài khoản Real của chính bạn (kể cả tài khoản cho copy). Vốn quỹ và tài khoản demo không tính.
  const own = bridge.accounts.filter((a) => infos[a.id]?.env === 'real' && infos[a.id]?.role !== 'prop')
  const held = own.reduce((s, a) => s + a.equity, 0)
  const s = useMemo(() => summarize(entries, held), [entries, held])
  const sorted = useMemo(() => [...entries].sort((a, b) => b.date.localeCompare(a.date)), [entries])

  function add() {
    if (!(amount > 0) || !date) { setMsg('Cần nhập ngày và số tiền lớn hơn 0.'); return }
    setEntries([...entries, { id: `m${Date.now()}`, date, flow, category, amount, note: note.trim() || undefined }])
    setAmount(NaN); setNote(''); setMsg('')
  }

  async function importMt5() {
    let all = entries
    const parts: string[] = []
    for (const a of own) {
      try {
        const h = await bridgeGet<{ deals: Mt5Deal[] }>(`/history?days=3650&account=${a.id}`)
        const ids = new Set(all.map((e) => e.id))
        const fresh = balanceDealsToEntries(h.deals, a.id, labels[a.id] ?? a.label).filter((e) => !ids.has(e.id))
        all = [...all, ...fresh]
        parts.push(`${labels[a.id] ?? a.label}: thêm ${fresh.length} dòng`)
      } catch (e) { parts.push(`${a.label}: lỗi (${e instanceof Error ? e.message : 'không rõ'})`) }
    }
    setEntries(all)
    setMsg(parts.join(' · ') + '. Hãy xem lại: MT5 đôi khi ghi cả thưởng hay điều chỉnh dưới dạng nạp/rút.')
  }

  return (
    <>
      <h1>Thu chi đầu tư</h1>
      <div className="tiles wide">
        <Tile label="Đã bỏ ra" value={money(s.out, ccy)} sub="Phí quỹ, nạp tài khoản, công cụ, khoá học…" />
        <Tile label="Đã thu về" value={money(s.in, ccy)} sub="Rút từ quỹ, từ tài khoản, backcom, affiliate…" />
        <Tile tone={s.net} label="Dòng tiền ròng" value={`${signed(s.net)} ${ccy}`} sub="Thu về trừ bỏ ra" />
        <Tile label="Còn trong tài khoản của bạn" value={own.length ? money(s.held, ccy) : '–'} sub={own.length ? own.map((a) => labels[a.id] ?? a.label).join(', ') : 'Nối tài khoản Real qua MT5 để tính'} />
        <Tile tone={s.total} label="Lãi/lỗ tổng" value={`${signed(s.total)} ${ccy}`} sub={own.length ? 'Dòng tiền ròng + tiền còn trong tài khoản. Chỉ đúng khi đã ghi đủ mọi lần nạp.' : 'Chưa gồm tiền còn trong tài khoản thật'} />
        <Tile label="Tỷ suất trên tiền bỏ ra" value={s.roi == null ? '–' : `${s.roi > 0 ? '+' : ''}${pct(s.roi)}`} sub="Lãi/lỗ tổng chia tổng đã bỏ ra" />
      </div>

      <section className="card">
        <h3>Thêm khoản</h3>
        <div className="prop-form">
          <Field group label="Loại">
            <div className="seg">
              <button className={flow === 'out' ? 'active' : ''} aria-pressed={flow === 'out'} onClick={() => { setFlow('out'); setCategory(CATEGORIES.out[0].id) }}>Bỏ ra</button>
              <button className={flow === 'in' ? 'active' : ''} aria-pressed={flow === 'in'} onClick={() => { setFlow('in'); setCategory(CATEGORIES.in[0].id) }}>Thu về</button>
            </div>
          </Field>
          <Field label="Danh mục"><select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES[flow].map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
          <Field label="Ngày"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={`Số tiền (${ccy})`}><Num value={amount} onChange={setAmount} min={0} /></Field>
          <Field label="Ghi chú"><input value={note} placeholder="VD: FTMO 100K lần 2" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></Field>
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="primary" onClick={add}>Thêm</button>
          <button disabled={!own.length} title={own.length ? '' : 'Cần nối tài khoản thật qua MT5'} onClick={importMt5}>Lấy nạp/rút từ MT5</button>
          <button className="ghost" disabled={!entries.length} onClick={() => download('thu-chi.csv', ledgerCsv(sorted), 'text/csv')}>Xuất CSV</button>
        </div>
        {msg && <p className="notice">{msg}</p>}
        <p className="muted small">Mọi khoản ghi bằng {ccy}; khoản bằng tiền khác hãy tự quy đổi trước khi nhập.</p>
      </section>

      <div className="grid-2">
        <BarTable simple valueLabel={`Số tiền (${ccy})`} title="Theo danh mục" rows={s.byCategory.map((c) => ({ key: c.label, n: c.n, net: c.flow === 'in' ? c.amount : -c.amount, wins: 0, winRate: 0 }))} note="Thanh sang phải là thu về, sang trái là bỏ ra." />
        <BarTable simple valueLabel={`Ròng (${ccy})`} title="Dòng tiền ròng theo tháng" rows={s.byMonth.map((m) => ({ key: m.month, n: 0, net: m.net, wins: 0, winRate: 0 }))} note={s.byMonth.length ? `Luỹ kế tới nay: ${signed(s.net)} ${ccy}` : undefined} />
      </div>

      <section className="card">
        <h3>{entries.length} khoản đã ghi</h3>
        {sorted.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ngày</th><th>Loại</th><th>Danh mục</th><th className="num">Số tiền</th><th>Tài khoản</th><th>Ghi chú</th><th /></tr></thead>
              <tbody>
                {sorted.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{e.date}</td>
                    <td>{e.flow === 'out' ? 'Bỏ ra' : 'Thu về'}</td>
                    <td>{categoryLabel(e.category)}</td>
                    <td className="num strong"><span className={e.flow === 'in' ? 'pip pos' : 'pip neg'} />{signed(e.flow === 'in' ? e.amount : -e.amount)}</td>
                    <td>{e.account ? labels[e.account] ?? e.account : ''}</td>
                    <td className="muted">{e.note}</td>
                    <td><button className="ghost icon" aria-label="Xoá khoản này" onClick={() => setEntries(entries.filter((x) => x.id !== e.id))}>✕</button></td>
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
