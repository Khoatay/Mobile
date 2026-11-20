import { useEffect, useState } from 'react'
import { api, type Me } from '../lib/server'

const usd = (v: unknown) => `${Number(v ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} $`
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

interface MyIb { available: boolean; member?: boolean; checked?: number; accounts?: string[]; link?: string; rebates?: { account: string; status: string; rebateUsd: number; lots: number; date: string | null }[] }

/** Khách: mở Exness dưới link IB của chủ app thì được Pro miễn phí; thấy hoàn phí của mình. Ẩn khi chủ app chưa nối Exness. */
export function IbCard({ me, setMe }: { me: Me; setMe: (m: Me) => void }) {
  const [ib, setIb] = useState<MyIb | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api<MyIb>('/me/ib').then(setIb).catch(() => setIb({ available: false }))
  useEffect(() => { load() }, [me.plan])
  if (!ib?.available) return null
  const check = async () => {
    setBusy(true); setMsg(null)
    try {
      const m = await api<Me>('/me/ib/check', {})
      setMe(m); load()
      setMsg(m.ib?.member ? { ok: true, text: 'Đã xác nhận! Bạn được Pro miễn phí.' } : { ok: false, text: `Exness chưa thấy email ${m.email} thuộc nhánh này. Kiểm tra lại bạn đã mở tài khoản qua link bên dưới bằng đúng email này chưa.` })
    } catch (e) { setMsg({ ok: false, text: errText(e) }) } finally { setBusy(false) }
  }
  const total = (ib.rebates ?? []).filter((x) => x.status === 'PROCESSED').reduce((s, x) => s + x.rebateUsd, 0)
  return (
    <section className="lite-card">
      <div className="lite-label">Khách IB Exness</div>
      {ib.member ? (
        <>
          <p>✅ Tài khoản Exness của bạn ({(ib.accounts ?? []).join(', ') || me.email}) thuộc nhánh Golden Duck: <strong>Pro miễn phí</strong>.</p>
          {(ib.rebates ?? []).length > 0 ? (
            <>
              <p className="small">Hoàn phí đã nhận gần đây: <strong className="pos">{usd(total)}</strong></p>
              <ul className="srv-limits">{ib.rebates!.slice(0, 8).map((x, i) => <li key={i} className="small">{x.date ?? 'đang xử lý'} · TK {x.account} · {x.lots} lot · {usd(x.rebateUsd)}{x.status !== 'PROCESSED' ? ` (${x.status})` : ''}</li>)}</ul>
            </>
          ) : <p className="muted small">Chưa có đợt hoàn phí nào. Exness trả hoàn phí theo kỳ sau khi bạn giao dịch.</p>}
        </>
      ) : (
        <>
          <p>Mở tài khoản Exness qua link dưới đây, <strong>bằng đúng email {me.email}</strong>, để được <strong>Pro miễn phí</strong>.</p>
          {ib.link && <a className="primary lite-cta" href={ib.link} target="_blank" rel="noopener noreferrer">Mở tài khoản Exness</a>}
          <button className="lite-cta" disabled={busy} onClick={check}>{busy ? 'Đang hỏi Exness…' : 'Tôi đã mở, kiểm tra lại'}</button>
          <p className="muted small">Đã có tài khoản Exness bằng email khác thì đăng ký Golden Duck bằng email đó. App tự kiểm tra lại mỗi ngày.</p>
        </>
      )}
      {msg && <p className={msg.ok ? 'notice' : 'notice bad'}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
    </section>
  )
}

interface AdminEx {
  configured: boolean; ready?: boolean; error?: string; ibUsers?: number; link?: string
  summary?: { clients_count?: number; summary_reward?: { amount: string; currency: string } | null; error?: string }
  rewards?: { totals?: { reward_usd: string; volume_lots: number; orders_count: number }; error?: string }
  payments?: { totals?: { processed_rebate_usd: number; rejected_rebate_usd: number; error_rebate_usd: number }; data?: { status: string }[]; error?: string }
  groups?: { data?: { id: number; group_title: string; group_type: string; clients_count: number | null; rebate_percent: number | null; link_code: string | null }[]; error?: string }
}

/** Chủ app: báo cáo IB từ Exness Partnership API. */
export function IbAdmin() {
  const [r, setR] = useState<AdminEx | null>(null)
  const [e, setE] = useState('')
  useEffect(() => { api<AdminEx>('/admin/exness').then(setR).catch((x) => setE(errText(x))) }, [])
  if (e) return <section className="lite-card"><div className="lite-label">Exness IB</div><p className="notice bad">⚠ {e}</p></section>
  if (!r) return null
  if (!r.configured) return (
    <section className="lite-card">
      <div className="lite-label">Exness IB</div>
      <p className="muted">Chưa nối Exness Partnership API. Dán khoá vào <code>/opt/golden-duck/.env</code> trên VPS (EXN_API_BASE_URL, EXN_API_KEY, EXN_PRIVATE_KEY) rồi khởi động lại máy chủ. Có khoá rồi: khách mở Exness dưới link của bạn được Pro tự động, và bảng IB hiện ở đây.</p>
    </section>
  )
  if (!r.ready) return <section className="lite-card"><div className="lite-label">Exness IB</div><p className="notice bad">⚠ Khoá chưa dùng được: {r.error}</p></section>
  const groups = r.groups?.data ?? []
  const full = groups.find((g) => (g.rebate_percent ?? 0) >= 100)
  return (
    <section className="lite-card">
      <div className="lite-label">Exness IB</div>
      <div className="srv-usage">
        <div><span>Khách của bạn</span><strong>{r.summary?.clients_count ?? '–'}</strong><small>trên Exness</small></div>
        <div><span>Đang dùng Pro nhờ IB</span><strong>{r.ibUsers ?? 0}</strong><small>trên Golden Duck</small></div>
        <div><span>Hoa hồng 30 ngày</span><strong>{usd(r.rewards?.totals?.reward_usd)}</strong><small>{r.rewards?.totals?.volume_lots ?? 0} lot</small></div>
        <div><span>Đã hoàn cho khách</span><strong>{usd(r.payments?.totals?.processed_rebate_usd)}</strong><small>các đợt gần đây</small></div>
      </div>
      {r.summary?.summary_reward && <p className="muted small">Tổng hoa hồng: {r.summary.summary_reward.amount} {r.summary.summary_reward.currency}</p>}
      {(r.payments?.totals?.error_rebate_usd ?? 0) > 0 && <p className="warn small">⚠ Có {usd(r.payments!.totals!.error_rebate_usd)} hoàn phí bị lỗi khi trả: xem trong trang đối tác Exness.</p>}
      <div className="lite-label" style={{ marginTop: 12 }}>Nhóm hoàn phí</div>
      {groups.length ? (
        <ul className="srv-limits">{groups.map((g) => <li key={g.id} className="small"><strong>{g.group_title}</strong> · {g.rebate_percent ?? '?'}% · {g.group_type}{g.link_code ? ` · link ${g.link_code}` : ''} · {g.clients_count ?? 0} khách</li>)}</ul>
      ) : <p className="muted small">Chưa có nhóm hoàn phí nào.</p>}
      {!full && <p className="warn small">⚠ Chưa có nhóm hoàn 100%. Tạo trong trang đối tác Exness (Autorebates / Rebate group), gắn vào link giới thiệu, để khách mở qua link được hoàn 100% tự động.</p>}
      {r.link && <p className="muted small">Link giới thiệu mặc định: <code>{r.link}</code></p>}
      {[r.summary, r.rewards, r.payments, r.groups].some((x) => x?.error) && <p className="notice bad small">⚠ {[r.summary, r.rewards, r.payments, r.groups].map((x) => x?.error).filter(Boolean)[0]}</p>}
    </section>
  )
}
