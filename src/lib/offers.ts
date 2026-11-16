import { PARTNERS, type PartnerKind, type PartnerLinks } from './partners'

export type OfferKind = PartnerKind | 'other'
export interface Offer {
  id: string
  /** id trong PARTNERS, hoặc rỗng nếu là đối tác khác (ghi ở partnerName). */
  partner: string
  partnerName: string
  kind: OfferKind
  title: string
  detail: string
  code: string
  /** Rỗng thì dùng link giới thiệu đã lưu cho đối tác này. */
  url: string
  /** yyyy-mm-dd, rỗng = không hết hạn. */
  expires: string
  pinned: boolean
  createdAt: number
}

export const OFFER_KIND_TEXT: Record<OfferKind, string> = { broker: 'Sàn', prop: 'Quỹ', tool: 'Công cụ', other: 'Khác' }

export const blankOffer = (): Offer => ({ id: `o${Date.now()}`, partner: 'ftmo', partnerName: '', kind: 'prop', title: '', detail: '', code: '', url: '', expires: '', pinned: false, createdAt: Date.now() })

export function offerName(o: Offer): string {
  return PARTNERS.find((p) => p.id === o.partner)?.name ?? (o.partnerName || 'Đối tác')
}

export function offerUrl(o: Offer, links: PartnerLinks): string {
  return o.url || links[o.partner]?.url || ''
}

/** Số ngày còn lại tới hết hạn (0 = hết hạn hôm nay, âm = đã hết hạn), null nếu không có hạn. */
export function daysLeft(o: Offer, now = Date.now()): number | null {
  if (!o.expires) return null
  const end = Date.parse(o.expires + 'T23:59:59')
  return Math.floor((end - now) / 86_400_000)
}

/** Ghim lên đầu, rồi ưu đãi sắp hết hạn, rồi mới nhất. */
export function sortOffers(list: Offer[], now = Date.now()): Offer[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const da = daysLeft(a, now), db = daysLeft(b, now)
    if (da != null && db != null && da !== db) return da - db
    if ((da == null) !== (db == null)) return da == null ? 1 : -1
    return b.createdAt - a.createdAt
  })
}

export function offerCaption(o: Offer, links: PartnerLinks, disclaimer: boolean): string {
  const left = daysLeft(o)
  return [
    `🎁 ${offerName(o)}: ${o.title}`,
    o.detail,
    o.code ? `Mã: ${o.code}` : '',
    o.expires ? `Hạn: ${o.expires.split('-').reverse().join('/')}${left != null && left >= 0 && left <= 7 ? ` (còn ${left} ngày)` : ''}` : '',
    offerUrl(o, links) ? `👉 ${offerUrl(o, links)}` : '',
    disclaimer ? 'Giao dịch có rủi ro mất vốn. Đọc điều khoản của đối tác trước khi tham gia.' : '',
  ].filter(Boolean).join('\n')
}
