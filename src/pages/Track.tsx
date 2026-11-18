import { useEffect, useMemo, useState } from 'react'
import { Field, Num } from '../components/Field'
import ScopeSelect from '../components/ScopeSelect'
import { inScope, scopeLabel, type InfoMap } from '../lib/accounts'
import type { PartnerLinks } from '../lib/partners'
import type { Profile } from '../lib/share'
import { download } from '../lib/store'
import { logoDataUrl } from '../lib/brand'
import { dataHash, trackRecordHtml } from '../lib/trackrecord'
import type { Trade } from '../lib/types'

const RANGES = [{ v: 0, label: 'Toàn bộ' }, { v: 30, label: '30 ngày' }, { v: 90, label: '90 ngày' }, { v: 180, label: '6 tháng' }, { v: 365, label: '1 năm' }]

export default function Track({ trades, infos, profile, links, currency }: { trades: Trade[]; infos: InfoMap; profile: Profile; links: PartnerLinks; currency: string }) {
  const accountIds = useMemo(() => [...new Set(trades.map((t) => t.account).filter((a): a is string => !!a))], [trades])
  const [scope, setScope] = useState('')
  const [days, setDays] = useState(0)
  const [title, setTitle] = useState('Thành tích giao dịch')
  const [subtitle, setSubtitle] = useState('')
  const [hideMoney, setHideMoney] = useState(profile.hideMoney)
  const [onlyMt5, setOnlyMt5] = useState(true)
  const [recent, setRecent] = useState(20)
  const [cta, setCta] = useState(Object.keys(links)[0] ?? '')
  const [hash, setHash] = useState('')
  const [msg, setMsg] = useState('')

  const list = useMemo(() => {
    const latest = Math.max(0, ...trades.map((t) => t.closeTime))
    return trades.filter((t) => inScope(scope, t.account, infos) && (!days || t.closeTime >= latest - days * 86_400_000) && (!onlyMt5 || (t.source === 'mt5' && t.account)))
  }, [trades, scope, days, onlyMt5, infos])
  useEffect(() => { dataHash(list).then(setHash) }, [list])
  const [logo, setLogo] = useState('')
  useEffect(() => { logoDataUrl().then(setLogo) }, [])

  const link = cta ? links[cta] : undefined
  const html = useMemo(() => hash ? trackRecordHtml(list, {
    title, subtitle: subtitle || (scope ? scopeLabel(scope, infos) : ''), brand: profile.brand, logo, accent: profile.accent,
    hideMoney, currency, ctaLabel: link?.cta || (link?.name ? `Mở tài khoản ${link.name}` : ''), ctaUrl: link?.url || profile.link, disclaimer: profile.disclaimer, recent,
  }, hash) : '', [list, hash, logo, title, subtitle, scope, hideMoney, recent, link, profile, currency])

  const copy = async () => {
    try { await navigator.clipboard.writeText(html); setMsg('Đã sao chép mã HTML.') } catch { setMsg('Trình duyệt không cho sao chép tự động.') }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Thành tích công khai</h1>
          <p className="muted">Tạo một trang web độc lập từ nhật ký, có thương hiệu và link giới thiệu của bạn. Đăng lên bất kỳ đâu (GitHub Pages, Netlify, trang web riêng) hoặc gửi file cho khách.</p>
        </div>
      </div>
      <div className="track">
        <section className="card form">
          {accountIds.length > 0 && <Field label="Tài khoản"><ScopeSelect value={scope} onChange={setScope} infos={infos} ids={accountIds} /></Field>}
          <Field group label="Khoảng thời gian">
            <div className="seg">{RANGES.map((r) => <button key={r.v} className={days === r.v ? 'active' : ''} aria-pressed={days === r.v} onClick={() => setDays(r.v)}>{r.label}</button>)}</div>
          </Field>
          <Field label="Tiêu đề"><input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Dòng phụ" hint="Trống = tên tài khoản hoặc nhóm"><input value={subtitle} maxLength={100} placeholder="VD: Tài khoản FTMO 100K, phương pháp ICT" onChange={(e) => setSubtitle(e.target.value)} /></Field>
          {Object.keys(links).length > 0 && (
            <Field label="Nút kêu gọi cuối trang">
              <select value={cta} onChange={(e) => setCta(e.target.value)}>
                <option value="">Dùng link chính ở Cá nhân hoá</option>
                {Object.entries(links).map(([id, l]) => <option key={id} value={id}>{l.name ?? id}{l.cta ? ` · ${l.cta}` : ''}</option>)}
              </select>
            </Field>
          )}
          <Field label="Số lệnh gần nhất hiện ra" hint="0 = không hiện bảng lệnh"><Num value={recent} onChange={(v) => setRecent(Math.max(0, Math.min(200, Math.round(v || 0))))} min={0} /></Field>
          <label className="inline wrap"><input type="checkbox" className="check" checked={hideMoney} onChange={(e) => setHideMoney(e.target.checked)} /> Ẩn số tiền (chỉ hiện pip, R, tỷ lệ thắng)</label>
          <label className="inline wrap"><input type="checkbox" className="check" checked={onlyMt5} onChange={(e) => setOnlyMt5(e.target.checked)} /> Chỉ dùng lệnh đọc thẳng từ MT5 (bỏ lệnh nhập tay, nhập file)</label>
          <div className="actions">
            <button className="primary" disabled={!list.length} onClick={() => download(`${title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'thanh-tich'}.html`, html, 'text/html')}>Tải file HTML</button>
            <button disabled={!list.length} onClick={copy}>Sao chép mã HTML</button>
          </div>
          {msg && <p className="notice">{msg}</p>}
          <p className="muted small">{list.length} lệnh. Trang có mã kiểm tra SHA-256 của dữ liệu: ai muốn kiểm tra có thể so mã khi bạn xuất lại cùng khoảng thời gian. Đây là cam kết minh bạch, không phải chứng nhận của bên thứ ba.</p>
        </section>
        <div className="track-preview">
          {list.length ? <iframe title="Xem trước trang thành tích" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" /> : <div className="card empty"><p className="muted">Không có lệnh nào trong phạm vi này{onlyMt5 ? ' đọc từ MT5' : ''}.</p></div>}
        </div>
      </div>
    </>
  )
}
