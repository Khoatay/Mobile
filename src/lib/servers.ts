/**
 * Gợi ý tên máy chủ MT5 khi thêm tài khoản, để khỏi gõ tay.
 * Nguồn: (1) máy chủ bridge thấy trên máy khách (đã từng đăng nhập, chắc chắn đúng); (2) tên thường gặp của vài sàn.
 * Tên thường gặp tổng hợp từ hướng dẫn bên thứ ba (11/2026), sàn có thể đổi: tên đúng luôn nằm trong email mở tài khoản
 * hoặc trang quản lý tài khoản của sàn. Quỹ (FTMO, The5ers…) chưa có nguồn đáng tin nên không liệt kê sẵn.
 */
const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`)

export const COMMON_SERVERS: { broker: string; servers: string[] }[] = [
  // Exness đánh số máy chủ theo từng tài khoản: Real/Trial + số.
  { broker: 'Exness', servers: ['Exness-MT5Real', ...range('Exness-MT5Real', 2, 40), 'Exness-MT5Trial', ...range('Exness-MT5Trial', 2, 20)] },
  { broker: 'IC Markets', servers: ['ICMarketsSC-MT5', 'ICMarketsSC-MT5-2', 'ICMarketsSC-MT5-3', 'ICMarketsSC-MT5-4', 'ICMarketsSC-MT5-6', 'ICMarketsSC-Demo', 'ICMarketsEU-MT5-5', 'ICMarketsEU-Demo', 'ICMarketsAU-Live'] },
  { broker: 'MetaQuotes', servers: ['MetaQuotes-Demo'] },
]

/** Danh sách gợi ý: máy chủ đã dùng trên máy trước, rồi tới tên thường gặp (ưu tiên sàn đã chọn). */
export function serverOptions(found: string[], broker: string): { name: string; note: string }[] {
  const b = broker.trim().toLowerCase().replace(/\s/g, '')
  const common = [...COMMON_SERVERS].sort((x, y) => Number(y.broker.toLowerCase().replace(/\s/g, '').includes(b) && !!b) - Number(x.broker.toLowerCase().replace(/\s/g, '').includes(b) && !!b))
  const seen = new Set<string>()
  const out: { name: string; note: string }[] = []
  for (const n of found) if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push({ name: n, note: 'đã dùng trên máy chạy bridge' }) }
  for (const g of common) for (const n of g.servers) if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push({ name: n, note: g.broker }) }
  return out
}
