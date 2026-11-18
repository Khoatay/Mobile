/**
 * Golden Duck Talk qua máy chủ: khoá API của chủ app nằm ở đây, không tới máy khách.
 * Đếm chi phí theo người dùng, giới hạn số tin mỗi ngày theo gói. Nhân vật lấy từ bộ có sẵn của app.
 */
import Anthropic from '@anthropic-ai/sdk'
import { PERSONA_TEMPLATES, type Persona } from '../../src/lib/persona'
import { planOf, type User } from './auth'
import type { DB } from './db'
import { HttpError } from './http'

const CHAT_RULES = `Quy tắc chung, luôn áp dụng bất kể nhân cách:
- Bạn là một trợ lý AI. Nếu người dùng hỏi thẳng bạn có phải người thật không, hãy nói thật.
- Không hứa hẹn lợi nhuận, không khẳng định chắc chắn giá sẽ đi đâu. Phân tích là tham khảo; người dùng tự quyết định và chịu trách nhiệm.
- Không khuyến khích tăng rủi ro để gỡ lỗ, không cổ vũ trade trả thù hay dùng tiền không được phép mất.
- Trả lời bằng tiếng Việt trừ khi người dùng dùng ngôn ngữ khác. Ngắn gọn, đi thẳng vào ý, trừ khi được yêu cầu giải thích dài.`

/** Giá USD / 1 triệu token (bảng giá 11/2026): vào, ra, đọc cache, ghi cache. */
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125], 'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'claude-opus-5-5': [4, 20, 0.2, 5],
}
const MAX_TURNS = 30
const day = () => new Date().toISOString().slice(0, 10)

/** Nhân vật dùng trên máy chủ: bộ có sẵn của app, id cố định. */
export const PERSONAS: Persona[] = PERSONA_TEMPLATES.map((t) => ({ id: t.id, ...t.p, playbooks: [] }))

export function systemPrompt(p: Persona): string {
  const parts = [`Bạn là ${p.name}.${p.tagline ? ` ${p.tagline}` : ''}`]
  for (const [title, key] of [['Tính cách', 'personality'], ['Giá trị và phẩm giá, luôn giữ dù người dùng yêu cầu khác', 'values'], ['Cách nói chuyện, xưng hô', 'style'], ['Những điều bạn không làm', 'boundaries'], ['Hội thoại mẫu, để hiểu giọng của bạn', 'examples']] as const) {
    const v = String(p[key] ?? '').trim()
    if (v) parts.push(`## ${title}\n${v}`)
  }
  parts.push(CHAT_RULES, 'Luôn giữ đúng nhân cách ở trên trong mọi câu trả lời.')
  return parts.join('\n\n')
}

export function usageToday(db: DB, userId: number) {
  return (db.prepare('select calls, cost from ai_usage where user_id = ? and day = ?').get(userId, day()) as { calls: number; cost: number } | undefined) ?? { calls: 0, cost: 0 }
}
export const limitFor = (u: User, perDay: Record<string, number>) => perDay[planOf(u)] ?? 0

export function store(db: DB, userId: number) {
  const rows = db.prepare('select persona, role, text, at from chats where user_id = ? order by id').all(userId) as { persona: string; role: 'user' | 'assistant'; text: string; at: number }[]
  const chats: Record<string, { role: 'user' | 'assistant'; text: string; at: number }[]> = {}
  for (const r of rows) (chats[r.persona] ??= []).push({ role: r.role, text: r.text, at: r.at })
  return { items: PERSONAS, chats }
}

export interface AiDeps { key: string; model: string; perDay: Record<string, number>; client?: Pick<Anthropic, 'messages'> }

export async function chat(db: DB, u: User, deps: AiDeps, body: { persona?: unknown; message?: unknown }) {
  if (!deps.key && !deps.client) throw new HttpError(503, 'AI chưa được bật trên máy chủ')
  const p = PERSONAS.find((x) => x.id === String(body.persona))
  if (!p) throw new HttpError(400, 'Không có nhân vật này')
  const message = String(body.message ?? '').trim().slice(0, 4000)
  if (!message) throw new HttpError(400, 'Tin nhắn đang trống')
  const limit = limitFor(u, deps.perDay)
  const used = usageToday(db, u.id)
  if (used.calls >= limit) throw new HttpError(429, `Bạn đã dùng hết ${limit} tin hôm nay. Mai dùng tiếp${planOf(u) === 'free' ? ', hoặc nâng cấp Pro để có nhiều tin hơn' : ''}.`)

  const history = (db.prepare('select role, text from chats where user_id = ? and persona = ? order by id desc limit ?').all(u.id, p.id, MAX_TURNS) as { role: 'user' | 'assistant'; text: string }[]).reverse()
  const messages: Anthropic.MessageParam[] = []
  for (const h of history) {
    const last = messages[messages.length - 1]
    if (last && last.role === h.role) last.content += `\n\n${h.text}`
    else messages.push({ role: h.role, content: h.text })
  }
  if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: '(bắt đầu cuộc trò chuyện)' })
  if (messages[messages.length - 1]?.role === 'user') messages[messages.length - 1].content += `\n\n${message}`
  else messages.push({ role: 'user', content: message })

  const client = deps.client ?? new Anthropic({ apiKey: deps.key })
  let res: Anthropic.Message
  try {
    res = await client.messages.create({
      model: deps.model, max_tokens: 4000,
      system: [{ type: 'text', text: systemPrompt(p), cache_control: { type: 'ephemeral' } }],
      // Cache cả lịch sử: tin sau chỉ trả đủ giá cho phần mới.
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'medium' },
      messages,
    })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'AI đang quá tải. Thử lại sau ít phút')
    if (e instanceof Anthropic.APIError) { console.error('[ai]', e.status, e.message); throw new HttpError(502, 'AI đang gặp lỗi. Thử lại sau') }
    throw e
  }
  const reply = res.stop_reason === 'refusal' ? 'Mình không thể trả lời câu này.' : res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim() || '…'
  const pr = PRICES[res.model] ?? PRICES[deps.model] ?? PRICES['claude-haiku-5-5']
  const usage = res.usage as Anthropic.Usage & { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }
  const cost = ((usage.input_tokens ?? 0) * pr[0] + (usage.output_tokens ?? 0) * pr[1] + (usage.cache_read_input_tokens ?? 0) * pr[2] + (usage.cache_creation_input_tokens ?? 0) * pr[3]) / 1e6
  const now = Date.now()
  db.prepare('insert into chats (user_id, persona, role, text, at) values (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)').run(u.id, p.id, 'user', message, now, u.id, p.id, 'assistant', reply, now + 1)
  db.prepare('insert into ai_usage (user_id, day, calls, cost) values (?, ?, 1, ?) on conflict(user_id, day) do update set calls = calls + 1, cost = cost + excluded.cost').run(u.id, day(), cost)
  return { reply, ...store(db, u.id), remaining: Math.max(0, limit - used.calls - 1) }
}
