export type Side = 'buy' | 'sell'

export interface Trade {
  /** Khoá duy nhất: nguồn + số ticket, dùng để chống import trùng. */
  id: string
  ticket: string
  /** Mã đã chuẩn hoá (EURUSD, XAUUSD) hoặc mã gốc nếu không nhận ra. */
  symbol: string
  side: Side
  volume: number
  /** Giờ máy chủ broker, lưu dạng epoch ms như thể là UTC. */
  openTime: number
  closeTime: number
  openPrice: number
  closePrice: number
  sl: number
  tp: number
  commission: number
  swap: number
  profit: number
  source: 'mt5' | 'mt4' | 'csv' | 'manual' | 'demo'
  /** Số tài khoản MT5 (login), nếu biết. Dùng để tách thống kê và luật quỹ theo tài khoản. */
  account?: string
  setup?: string
  note?: string
}

export interface Settings {
  accountCcy: string
  balance: number
  riskPct: number
  leverage: number
  /** Múi giờ máy chủ broker so với UTC (đa số broker: +2 mùa đông, +3 mùa hè). */
  serverOffset: number
  /** Tỷ giá theo cách yết chuẩn: EURUSD, USDJPY, XAUUSD... */
  quotes: Record<string, number>
  quotesUpdatedAt: number | null
  /** Nguồn của từng giá: mẫu, internet, MT5 hay nhập tay. */
  quoteFrom?: Record<string, QuoteFrom>
}

export type QuoteFrom = 'sample' | 'internet' | 'mt5' | 'manual'

export const netOf = (t: Trade) => t.profit + t.commission + t.swap
