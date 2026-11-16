/** Cửa hàng (bot, indicator, khoá học…) và các nhóm cộng đồng của IB. */
export type ProductCategory = 'ea' | 'mt5' | 'tv' | 'course' | 'pdf' | 'other'
export const CATEGORY_TEXT: Record<ProductCategory, string> = {
  ea: 'Bot trade (EA MT5)', mt5: 'Indicator MT5', tv: 'Indicator TradingView', course: 'Khoá học', pdf: 'Sách, tài liệu', other: 'Khác',
}

export interface Product {
  id: string
  category: ProductCategory
  name: string
  tagline: string
  description: string
  features: string[]
  /** Giá ghi dạng chữ để linh hoạt: "1.990.000đ", "49 USD/tháng", "Miễn phí cho khách IB". */
  price: string
  oldPrice: string
  image: string
  buyUrl: string
  buyLabel: string
  badge: string
  visible: boolean
  createdAt: number
}

export type CommunityKind = 'channel' | 'group' | 'other'
export const COMMUNITY_KIND_TEXT: Record<CommunityKind, string> = { channel: 'Kênh', group: 'Nhóm chat', other: 'Khác' }

export interface Community {
  id: string
  kind: CommunityKind
  name: string
  description: string
  /** Quà hoặc quyền lợi khi tham gia, ví dụ "Tải sách PDF miễn phí". */
  perk: string
  /** Điều kiện tham gia, ví dụ "Dành cho khách mở tài khoản dưới link IB". Trống = ai cũng vào được. */
  condition: string
  url: string
  image: string
  visible: boolean
  createdAt: number
}

export const blankProduct = (): Product => ({ id: `p${Date.now()}`, category: 'ea', name: '', tagline: '', description: '', features: [], price: '', oldPrice: '', image: '', buyUrl: '', buyLabel: '', badge: '', visible: true, createdAt: Date.now() })
export const blankCommunity = (): Community => ({ id: `c${Date.now()}`, kind: 'channel', name: '', description: '', perk: '', condition: '', url: '', image: '', visible: true, createdAt: Date.now() })

/** Link Telegram: chấp nhận t.me/…, @ten hoặc https://… */
export function telegramUrl(v: string): string {
  const t = v.trim()
  if (!t) return ''
  if (/^@[\w\d_]{4,}$/.test(t)) return `https://t.me/${t.slice(1)}`
  if (/^t\.me\//i.test(t)) return `https://${t}`
  return t
}
