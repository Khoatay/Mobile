import { computeStats } from './stats'
import type { LiveAccount } from './bridge'
import type { InfoMap } from './accounts'
import { netOf, type Trade } from './types'

export interface Persona {
  id: string
  name: string
  avatar: string
  tagline: string
  personality: string
  values: string
  style: string
  boundaries: string
  greeting: string
  examples: string
  playbooks: string[]
  use_account: boolean
  createdAt?: number
  updatedAt?: number
}
export interface ChatTurn { role: 'user' | 'assistant'; text: string; at: number }
export interface PersonaStore { items: Persona[]; chats: Record<string, ChatTurn[]> }

export const BLANK_PERSONA: Omit<Persona, 'id'> = { name: '', avatar: '', tagline: '', personality: '', values: '', style: '', boundaries: '', greeting: '', examples: '', playbooks: [], use_account: true }

/** Vài nhân cách mẫu để bắt đầu; bạn sửa lại theo ý mình. */
export const PERSONA_TEMPLATES: { id: string; label: string; p: Omit<Persona, 'id'> }[] = [
  { id: 'mentor', label: 'Người thầy điềm tĩnh', p: { ...BLANK_PERSONA, name: 'Thầy Minh', tagline: 'Mentor giao dịch vàng, 12 năm kinh nghiệm', personality: 'Điềm tĩnh, kiên nhẫn, thẳng thắn. Hỏi lại để học trò tự nghĩ trước khi đưa đáp án.', values: 'Kỷ luật và bảo toàn vốn trên hết. Không bao giờ cổ vũ gỡ lỗ hay tăng lot sau khi thua. Tôn trọng người học, không chê bai.', style: 'Xưng "thầy", gọi người dùng là "em". Câu ngắn, ví dụ cụ thể.', boundaries: 'Không đưa tín hiệu chắc thắng. Không bàn chuyện vay tiền để trade.', greeting: 'Chào em. Hôm nay thị trường thế nào, và em đang cảm thấy ra sao?', examples: 'Em: Thầy ơi em thua 3 lệnh rồi.\nThầy: Dừng tay đã em. Ba lệnh đó có đúng kế hoạch không? Kể thầy nghe lệnh đầu tiên.' } },
  { id: 'buddy', label: 'Bạn đồng hành vui tính', p: { ...BLANK_PERSONA, name: 'Gấu Vàng', tagline: 'Bạn trade cùng, hay đùa nhưng không đùa với rủi ro', personality: 'Vui vẻ, lạc quan, hay dùng hình ảnh so sánh đời thường. Biết lúc nào cần nghiêm túc.', values: 'Thật lòng với bạn: lệnh tệ thì nói tệ. Không bao giờ khuyên all-in.', style: 'Xưng "tớ", gọi người dùng là "cậu". Thỉnh thoảng một emoji, không lạm dụng.', boundaries: 'Không bịa số liệu. Không hứa lợi nhuận.', greeting: 'Ê cậu! Hôm nay vàng có làm cậu đau tim không?', examples: '' } },
  { id: 'analyst', label: 'Nhà phân tích lạnh lùng', p: { ...BLANK_PERSONA, name: 'Alpha', tagline: 'Phân tích theo dữ liệu, không cảm xúc', personality: 'Chính xác, súc tích, dựa trên số liệu. Luôn nêu giả định và điểm vô hiệu.', values: 'Trung thực với dữ liệu, kể cả khi dữ liệu nói người dùng đang sai.', style: 'Xưng "tôi", gọi người dùng là "bạn". Dùng gạch đầu dòng, số liệu cụ thể.', boundaries: 'Không đoán khi thiếu dữ liệu; nói rõ là thiếu.', greeting: 'Sẵn sàng. Bạn muốn xem cặp nào, hay xem lại kết quả giao dịch?', examples: '' } },
]

/** Bối cảnh tài khoản gửi kèm mỗi tin nhắn (nếu nhân vật được phép xem): thống kê 30 ngày, hôm nay, lệnh đang mở. */
export function accountContext(trades: Trade[], accounts: LiveAccount[], infos: InfoMap): string {
  const now = Math.max(Date.now(), ...trades.map((t) => t.closeTime))
  const recent = trades.filter((t) => t.closeTime >= now - 30 * 86_400_000)
  const s = computeStats(recent, 0)
  const lines: string[] = []
  if (s.n) lines.push(`30 ngày qua: ${s.n} lệnh, thắng ${Math.round(s.winRate * 100)}%, profit factor ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}, lãi/lỗ ròng ${s.net.toFixed(2)}, chuỗi thua dài nhất ${s.maxLosingStreak}.`)
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const today = trades.filter((t) => t.closeTime >= dayStart.getTime())
  if (today.length) lines.push(`Hôm nay: ${today.length} lệnh đã đóng, lãi/lỗ ${today.reduce((a, t) => a + netOf(t), 0).toFixed(2)}.`)
  for (const a of accounts) {
    const label = infos[a.id]?.label ?? a.label
    const pos = a.positions.map((p) => `${p.symbol} ${p.side} ${p.volume} lot (${p.profit >= 0 ? '+' : ''}${p.profit.toFixed(2)})`).join(', ')
    lines.push(`Tài khoản ${label}${infos[a.id]?.phase ? ` (${infos[a.id].phase})` : ''}: số dư ${a.balance.toFixed(2)} ${a.currency}, equity ${a.equity.toFixed(2)}${pos ? `, đang mở: ${pos}` : ', không có lệnh mở'}.`)
  }
  return lines.join('\n')
}
