// Thứ tự ưu tiên khi ghép cặp: đồng đứng trước là đồng cơ sở (base).
export const CURRENCIES = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'] as const
export const METALS = ['XAU', 'XAG'] as const
const KNOWN = new Set<string>([...CURRENCIES, ...METALS])

export const PAIRS: string[] = (() => {
  const out: string[] = []
  for (let i = 0; i < CURRENCIES.length; i++)
    for (let j = i + 1; j < CURRENCIES.length; j++) out.push(CURRENCIES[i] + CURRENCIES[j])
  const majors = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD']
  const rest = out.filter((p) => !majors.includes(p))
  return [...majors, 'XAUUSD', 'XAGUSD', ...rest]
})()

/** Các cặp cần nhập tỷ giá; mọi cặp chéo được suy ra từ đây. */
export const QUOTE_KEYS = ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'XAUUSD', 'XAGUSD']

/** Giá trị mẫu, chỉ để app chạy được ngay. Người dùng phải cập nhật trước khi tính lot thật. */
export const SAMPLE_QUOTES: Record<string, number> = {
  EURUSD: 1.08, GBPUSD: 1.27, AUDUSD: 0.65, NZDUSD: 0.6,
  USDJPY: 150, USDCHF: 0.88, USDCAD: 1.37, XAUUSD: 2600, XAGUSD: 30,
}

export interface SymbolInfo { symbol: string; base: string; quote: string }

const ALIASES: Record<string, string> = { GOLD: 'XAUUSD', SILVER: 'XAGUSD' }

/** Chuẩn hoá mã của broker: "EURUSD.m", "eurusd_pro", "GOLD" -> EURUSD / XAUUSD. */
export function parseSymbol(raw: string): SymbolInfo | null {
  let s = raw.toUpperCase().replace(/[^A-Z]/g, '')
  for (const a in ALIASES) if (s.startsWith(a)) s = ALIASES[a]
  const base = s.slice(0, 3)
  const quote = s.slice(3, 6)
  if (s.length < 6 || !KNOWN.has(base) || !KNOWN.has(quote) || base === quote) return null
  if ((METALS as readonly string[]).includes(quote)) return null
  return { symbol: base + quote, base, quote }
}

export function normalizeSymbol(raw: string): string {
  return parseSymbol(raw)?.symbol ?? raw.trim().toUpperCase()
}

export function contractSize(info: SymbolInfo): number {
  if (info.base === 'XAU') return 100
  if (info.base === 'XAG') return 5000
  return 100_000
}

/** 1 pip: 0.0001, cặp JPY 0.01, vàng 0.1 (1 lot vàng = 10 USD/pip), bạc 0.01. */
export function pipSize(info: SymbolInfo): number {
  if (info.base === 'XAU') return 0.1
  if (info.base === 'XAG') return 0.01
  return info.quote === 'JPY' ? 0.01 : 0.0001
}

/** Giá trị quy ra USD của 1 đơn vị tiền tệ / 1 oz kim loại. */
export function usdValue(ccy: string, quotes: Record<string, number>): number {
  if (ccy === 'USD') return 1
  const direct = quotes[ccy + 'USD']
  if (direct > 0) return direct
  const inverse = quotes['USD' + ccy]
  if (inverse > 0) return 1 / inverse
  return NaN
}

export function pairPrice(info: SymbolInfo, quotes: Record<string, number>): number {
  return usdValue(info.base, quotes) / usdValue(info.quote, quotes)
}

export interface PositionInput {
  symbol: string
  accountCcy: string
  balance: number
  riskPct: number
  slPips: number
  tpPips?: number
  leverage: number
  quotes: Record<string, number>
  lotStep?: number
}

export interface PositionResult {
  riskAmount: number
  /** Giá trị 1 pip của 1 lot, tính theo tiền tài khoản. */
  pipValuePerLot: number
  lotsExact: number
  /** Đã làm tròn XUỐNG theo bước lot để không vượt mức rủi ro. */
  lots: number
  units: number
  actualRisk: number
  actualRiskPct: number
  margin: number
  reward: number | null
  rr: number | null
  price: number
}

export function calcPosition(i: PositionInput): PositionResult | null {
  const info = parseSymbol(i.symbol)
  if (!info) return null
  const step = i.lotStep ?? 0.01
  const quoteToAcc = usdValue(info.quote, i.quotes) / usdValue(i.accountCcy, i.quotes)
  const baseToAcc = usdValue(info.base, i.quotes) / usdValue(i.accountCcy, i.quotes)
  if (![quoteToAcc, baseToAcc].every(Number.isFinite)) return null
  if (!(i.balance > 0 && i.riskPct > 0 && i.slPips > 0 && i.leverage > 0)) return null

  const size = contractSize(info)
  const pipValuePerLot = size * pipSize(info) * quoteToAcc
  const riskAmount = (i.balance * i.riskPct) / 100
  const lotsExact = riskAmount / (i.slPips * pipValuePerLot)
  const lots = Math.round(Math.floor(lotsExact / step + 1e-9) * step * 1e6) / 1e6
  const actualRisk = lots * i.slPips * pipValuePerLot
  const hasTp = i.tpPips != null && i.tpPips > 0
  return {
    riskAmount,
    pipValuePerLot,
    lotsExact,
    lots,
    units: lots * size,
    actualRisk,
    actualRiskPct: (actualRisk / i.balance) * 100,
    margin: (lots * size * baseToAcc) / i.leverage,
    reward: hasTp ? lots * i.tpPips! * pipValuePerLot : null,
    rr: hasTp ? i.tpPips! / i.slPips : null,
    price: pairPrice(info, i.quotes),
  }
}
