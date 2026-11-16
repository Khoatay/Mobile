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

/** Link giới thiệu và mã giảm giá của người dùng, theo id đối tác. */
export type PartnerLinks = Record<string, { url: string; code?: string }>

export function partnerFor(broker: string): Partner | undefined {
  const b = broker.trim().toLowerCase()
  if (!b) return undefined
  return PARTNERS.find((p) => p.aliases.some((a) => b.includes(a)))
}

export function isWebUrl(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
}
