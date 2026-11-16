import { useMemo, useRef, useState } from 'react'
import EquityChart from '../components/EquityChart'
import { demoTrades } from '../lib/demo'
import { money, signed } from '../lib/format'
import { computeInsights } from '../lib/insights'
import { decodeFile, parseReport } from '../lib/parse'
import { computeStats } from '../lib/stats'
import { mergeTrades } from '../lib/store'
import { netOf, type Settings, type Trade } from '../lib/types'
import { verdict } from './plain'

interface Props { trades: Trade[]; setTrades: (t: Trade[]) => void; settings: Settings; goFull: (tab?: string) => void }

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('vi-VN', { timeZone: 'UTC', day: '2-digit', month: '2-digit' })

/** Kết quả giao dịch nói bằng lời: lãi/lỗ, thắng bao nhiêu lệnh, điều cần sửa, và lệnh gần đây. */
export default function LiteResults({ trades, setTrades, settings, goFull }: Props) {
  const ccy = settings.accountCcy
  const s = useMemo(() => computeStats(trades, settings.serverOffset), [trades, settings.serverOffset])
  const tips = useMemo(() => computeInsights(trades, settings.serverOffset).filter((x) => x.tone !== 'info').slice(0, 3), [trades, settings.serverOffset])
  const recent = useMemo(() => [...trades].sort((a, b) => b.closeTime - a.closeTime).slice(0, 10), [trades])
  const [msg, setMsg] = useState('')
  const file = useRef<HTMLInputElement>(null)

  async function importFiles(files: FileList) {
    let all = trades, added = 0
    const errors: string[] = []
    for (const f of Array.from(files)) {
      try {
        const res = parseReport(decodeFile(await f.arrayBuffer()))
        if (!res.trades.length) { errors.push(`${f.name}: không thấy lệnh nào`); continue }
        const m = mergeTrades(all, res.trades)
        all = m.trades
        added += m.added
      } catch { errors.push(`${f.name}: không đọc được`) }
    }
    setTrades(all)
    setMsg([added ? `✓ Đã thêm ${added} lệnh.` : '', ...errors].filter(Boolean).join(' ') || 'Các lệnh trong file đã có sẵn.')
  }

  const uploader = (
    <>
      <input ref={file} type="file" accept=".htm,.html,.csv" multiple hidden onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = '' }} />
      <button className="primary lite-cta" onClick={() => file.current?.click()}>Chọn file lịch sử lệnh</button>
    </>
  )

  if (trades.length === 0)
    return (
      <>
        <h1>Kết quả</h1>
        <section className="lite-card">
          <p><strong>Xem bạn đang lãi hay lỗ, và thói quen nào đang làm bạn mất tiền.</strong></p>
          <p className="muted">Chỉ cần đưa file lịch sử từ MT5 vào đây:</p>
          <ol className="lite-howto">
            <li>Mở MT5 trên máy tính, chọn tab <b>Lịch sử</b> (History) ở dưới cùng.</li>
            <li>Bấm chuột phải vào danh sách lệnh → <b>Báo cáo</b> (Report) → <b>HTML</b>.</li>
            <li>Lưu file, rồi bấm nút dưới đây và chọn file đó.</li>
          </ol>
          {uploader}
          {msg && <p className="muted small">{msg}</p>}
          <button className="lite-link" onClick={() => setTrades(demoTrades())}>Chưa có file? Xem thử với dữ liệu mẫu →</button>
        </section>
        <p className="muted small">File chỉ được đọc trên máy này, không gửi đi đâu.</p>
      </>
    )

  return (
    <>
      <h1>Kết quả</h1>
      <section className="lite-card lite-balance">
        <div className="lite-label">Tổng lãi/lỗ ({s.n} lệnh)</div>
        <div className={s.net > 0 ? 'lite-big pos' : s.net < 0 ? 'lite-big neg' : 'lite-big'}>{signed(s.net)} <span>{ccy}</span></div>
        <div className="lite-winbar" role="img" aria-label={`Thắng ${s.wins} lệnh, thua ${s.losses} lệnh`}>
          <i className="pos" style={{ flex: s.wins || 0.0001 }} /><i className="neg" style={{ flex: s.losses || 0.0001 }} />
        </div>
        <div className="lite-sub">Thắng <b>{s.wins}</b> · Thua <b>{s.losses}</b> lệnh</div>
        <p className="lite-verdict">{verdict(s)}</p>
      </section>

      <section className="lite-card">
        <div className="lite-label">Tiền lãi/lỗ cộng dồn theo thời gian</div>
        <EquityChart points={s.equity} ccy={ccy} />
      </section>

      {tips.length > 0 && (
        <section className="lite-card">
          <div className="lite-label">Điều nên chú ý</div>
          <ul className="lite-tips">
            {tips.map((x) => (
              <li key={x.id} className={x.tone}>
                <span aria-hidden="true">{x.tone === 'bad' ? '⚠' : '✓'}</span>
                <div><strong>{x.title}</strong><p>{x.detail}</p></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="lite-card">
        <div className="lite-label">10 lệnh gần nhất</div>
        <ul className="lite-trades">
          {recent.map((t) => {
            const net = netOf(t)
            return (
              <li key={t.id}>
                <span className={t.side === 'buy' ? 'side buy' : 'side sell'}>{t.side === 'buy' ? 'Mua' : 'Bán'}</span>
                <span className="what"><strong>{t.symbol}</strong><small>{fmtDate(t.closeTime)} · {t.volume} lot</small></span>
                <strong className={net > 0 ? 'pos' : net < 0 ? 'neg' : ''}>{signed(net)}</strong>
              </li>
            )
          })}
        </ul>
        <button className="lite-link" onClick={() => goFull('stats')}>Xem thống kê chi tiết ở bản đầy đủ →</button>
      </section>

      <section className="lite-card">
        <div className="lite-label">Thêm lệnh mới</div>
        <p className="muted small">Xuất lại file lịch sử từ MT5 rồi chọn ở đây. Lệnh đã có sẽ không bị thêm trùng.</p>
        {uploader}
        {msg && <p className="muted small">{msg}</p>}
        {trades.every((t) => t.source === 'demo') && <button className="lite-link" onClick={() => { setTrades([]); setMsg('') }}>Xoá dữ liệu mẫu</button>}
      </section>
      {s.maxDrawdown > 0 && <p className="muted small">Lần tụt sâu nhất: {money(s.maxDrawdown, ccy)} từ đỉnh.</p>}
    </>
  )
}
