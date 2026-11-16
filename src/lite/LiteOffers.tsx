import { useState } from 'react'
import type { BrandPack } from '../lib/brandpack'
import { telegramUrl } from '../lib/catalog'
import { daysLeft, offerName, offerUrl, sortOffers } from '../lib/offers'
import type { PartnerLinks } from '../lib/partners'

interface Props { pack: BrandPack; links: PartnerLinks; disclaimer: boolean }

/** Ưu đãi và nhóm cộng đồng, chỉ xem: mỗi mục một thẻ với một nút bấm. */
export default function LiteOffers({ pack, links, disclaimer }: Props) {
  const offers = sortOffers(pack.offers).filter((o) => (daysLeft(o) ?? 0) >= 0)
  const groups = pack.communities.filter((c) => c.visible)
  const [copied, setCopied] = useState('')

  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setCopied(code) } catch { /* trình duyệt chặn: người dùng tự chép */ }
  }

  return (
    <>
      <h1>Ưu đãi</h1>
      {offers.length === 0 && groups.length === 0 && <section className="lite-card"><p className="muted">Hiện chưa có ưu đãi nào. Quay lại sau nhé.</p></section>}
      {offers.map((o) => {
        const url = offerUrl(o, links)
        const left = daysLeft(o)
        return (
          <section key={o.id} className="lite-card lite-offer">
            {o.image && <img src={o.image} alt="" />}
            <div className="lite-label">{offerName(o)}{left != null && left <= 7 && <span className="lite-soon"> · còn {left} ngày</span>}</div>
            <strong className="lite-offer-title">{o.title}</strong>
            {o.detail && <p className="muted">{o.detail}</p>}
            {o.code && <button className="lite-code" onClick={() => copy(o.code)}>Mã: <b>{o.code}</b> <small>{copied === o.code ? 'Đã chép ✓' : 'Bấm để chép'}</small></button>}
            {url && <a className="button primary lite-cta" href={url} target="_blank" rel="noreferrer">{o.cta || 'Nhận ưu đãi'}</a>}
          </section>
        )
      })}
      {groups.length > 0 && (
        <section className="lite-card">
          <div className="lite-label">Nhóm cộng đồng</div>
          <ul className="lite-groups">
            {groups.map((c) => (
              <li key={c.id}>
                <div><strong>{c.name}</strong>{c.perk && <small>🎁 {c.perk}</small>}{c.condition && <small className="muted">{c.condition}</small>}</div>
                <a className="button" href={telegramUrl(c.url)} target="_blank" rel="noreferrer">Vào nhóm</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {disclaimer && <p className="muted small">Giao dịch có rủi ro mất vốn. Đọc điều khoản của đối tác trước khi tham gia.</p>}
    </>
  )
}
