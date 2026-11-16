/** Sàn, quỹ và công cụ mà người dùng có link giới thiệu (IB, affiliate). */
export type PartnerKind = 'broker' | 'prop' | 'tool'
export interface Partner { id: string; name: string; kind: PartnerKind; site: string; aliases: string[] }

export const PARTNERS: Partner[] = [
  { id: 'exness', name: 'Exness', kind: 'broker', site: 'https://www.exness.com', aliases: ['exness'] },
  { id: 'icmarkets', name: 'IC Markets', kind: 'broker', site: 'https://www.icmarkets.com', aliases: ['icmarkets', 'ic markets', 'ictrading'] },
  { id: 'ftmo', name: 'FTMO', kind: 'prop', site: 'https://ftmo.com', aliases: ['ftmo'] },
  { id: 'the5ers', name: 'The5ers', kind: 'prop', site: 'https://the5ers.com', aliases: ['the5ers', '5ers', 'the 5ers', 'the5%ers'] },
  { id: 'tentrade', name: 'TenTrade', kind: 'prop', site: 'https://tentrade.com', aliases: ['tentrade', 'ten trade'] },
  { id: 'tradingview', name: 'TradingView', kind: 'tool', site: 'https://www.tradingview.com', aliases: ['tradingview'] },
]

export const KIND_TEXT: Record<PartnerKind, string> = { broker: 'Sàn (IB)', prop: 'Quỹ (affiliate)', tool: 'Công cụ' }

/** Một đối tác IB cấu hình: link, mã, chữ trên nút, câu giới thiệu ngắn, có hiện cho trader hay không. */
export interface PartnerConfig {
  id: string
  name: string
  kind: PartnerKind
  url: string
  code: string
  /** Chữ trên nút, ví dụ "Mở tài khoản giảm phí". Trống thì app tự đặt. */
  cta: string
  /** Một câu giới thiệu hiện cạnh nút. */
  pitch: string
  visible: boolean
  /** Đối tác do IB tự thêm (không có trong danh sách sẵn). */
  custom?: boolean
}

/** Link giới thiệu đang bật, theo id đối tác. Dùng ở trang Quỹ, Hướng dẫn, Ưu đãi. */
export type PartnerLinks = Record<string, { url: string; code?: string; cta?: string; pitch?: string; name?: string }>

export function defaultPartners(): PartnerConfig[] {
  return PARTNERS.map((p) => ({ id: p.id, name: p.name, kind: p.kind, url: '', code: '', cta: '', pitch: '', visible: true }))
}

/** Gộp danh sách sẵn có với cấu hình đã lưu (giữ thứ tự sẵn có, đối tác tự thêm nằm cuối). */
export function mergePartners(saved: PartnerConfig[] | undefined): PartnerConfig[] {
  const base = defaultPartners().map((d) => ({ ...d, ...(saved?.find((s) => s.id === d.id) ?? {}), name: d.name, kind: d.kind }))
  return [...base, ...(saved ?? []).filter((s) => s.custom)]
}

export function partnerLinks(list: PartnerConfig[]): PartnerLinks {
  const out: PartnerLinks = {}
  for (const p of list) if (p.visible && p.url) out[p.id] = { url: p.url, code: p.code || undefined, cta: p.cta || undefined, pitch: p.pitch || undefined, name: p.name }
  return out
}

export function partnerFor(broker: string, extra: PartnerConfig[] = []): { id: string; name: string } | undefined {
  const b = broker.trim().toLowerCase()
  if (!b) return undefined
  return PARTNERS.find((p) => p.aliases.some((a) => b.includes(a))) ?? extra.find((p) => p.custom && b.includes(p.name.trim().toLowerCase()))
}

export function isWebUrl(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
}
