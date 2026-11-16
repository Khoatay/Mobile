export interface KbSource { id: string; name: string; kind: 'pdf' | 'text' | 'transcript'; size: number; addedAt: number }
export interface ChatTurn { role: 'user' | 'assistant'; text: string; at: number }
export interface Playbook { id: string; name: string; rules: string; sources: KbSource[]; chat: ChatTurn[]; updatedAt: number }

export type Bias = 'up' | 'down' | 'range'
export interface Analysis {
  main_trend: Bias
  summary: string
  timeframes: { tf: string; bias: Bias; note: string }[]
  key_levels: { price: number; label: string }[]
  checklist: { rule: string; met: boolean; detail: string }[]
  has_trade: boolean
  trade: {
    side: 'buy' | 'sell' | 'none'
    order_type: 'market' | 'limit' | 'stop' | 'none'
    entry: number | null; sl: number | null; tp1: number | null; tp2: number | null; rr: number | null
    confidence: 'low' | 'medium' | 'high'
    invalidation: string
  }
  wait_for: string
}
export interface AnalysisResult { symbol: string; playbook: string; at: number; analysis: Analysis; model: string; features: unknown; usage?: { input: number; output: number } }

export const BIAS_TEXT: Record<Bias, string> = { up: '↑ Tăng', down: '↓ Giảm', range: '→ Đi ngang' }
export const CONFIDENCE_TEXT = { low: 'Thấp', medium: 'Vừa', high: 'Cao' }
export const ORDER_TEXT = { market: 'Lệnh thị trường', limit: 'Lệnh limit', stop: 'Lệnh stop', none: '' }

/** Bộ quy tắc mẫu để bắt đầu. Chỉ là điểm xuất phát: hãy sửa và dạy lại theo đúng cách bạn giao dịch. */
export const TEMPLATES: { id: string; name: string; rules: string }[] = [
  { id: 'blank', name: 'Trống', rules: '' },
  {
    id: 'ict', name: 'ICT cơ bản (mẫu)', rules: `## Khung thời gian
- Xu hướng: D1 và H4. Tìm điểm vào: M15.

## Xác định xu hướng và cấu trúc
- H4 tạo HH và HL là thiên hướng tăng; LH và LL là thiên hướng giảm.
- Chỉ giao dịch cùng thiên hướng H4.

## Vùng quan tâm (POI)
- FVG và order block trên H1 hoặc H4 còn chưa bị lấp.
- Mua trong vùng discount (dưới 50% biên swing H4), bán trong vùng premium.

## Điều kiện vào lệnh
- Giá quét thanh khoản (đỉnh/đáy phiên Á, đỉnh/đáy ngày trước, hoặc đỉnh/đáy bằng nhau).
- Sau khi quét, M15 có CHoCH cùng chiều thiên hướng H4.
- Vào lệnh limit tại FVG hoặc order block M15 tạo ra bởi cú CHoCH đó.

## Đặt stop loss
- Dưới đáy (trên đỉnh) của cú quét thanh khoản.

## Đặt take profit
- TP1 tại thanh khoản đối diện gần nhất. Chỉ vào lệnh khi R:R tới TP1 từ 1:2 trở lên.

## Khi nào không giao dịch
- 30 phút trước và sau tin mạnh của đồng tiền liên quan.
- Khi H4 đi ngang (cấu trúc lẫn lộn).` },
  {
    id: 'smc', name: 'SMC cơ bản (mẫu)', rules: `## Khung thời gian
- Cấu trúc: H4. Xác nhận và vào lệnh: M15.

## Xác định xu hướng và cấu trúc
- BOS cùng chiều trên H4 xác nhận xu hướng tiếp diễn. CHoCH trên H4 là dấu hiệu đảo chiều, chờ xác nhận.

## Vùng quan tâm (POI)
- Order block H4 chưa bị phá, ưu tiên order block đã quét thanh khoản trước khi tạo BOS.

## Điều kiện vào lệnh
- Giá chạm order block H4 cùng chiều xu hướng.
- M15 có CHoCH theo chiều xu hướng H4 bên trong vùng order block.

## Đặt stop loss
- Ngoài order block H4, cộng thêm 10% ATR H4.

## Đặt take profit
- TP1 tại đỉnh (đáy) swing H4 gần nhất. TP2 tại thanh khoản tiếp theo.

## Khi nào không giao dịch
- R:R tới TP1 dưới 1:2.` },
]
