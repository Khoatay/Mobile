/**
 * Nối bridge trên máy của khách (PC hoặc VPS Windows của họ, nơi chạy MT5) với máy chủ.
 *
 * - Bridge tự gọi ra máy chủ (long-poll), nên khách không phải mở cổng hay cấu hình mạng.
 * - Trình duyệt gọi /api/relay; máy chủ chuyển yêu cầu xuống đúng bridge của người đang đăng nhập rồi trả kết quả về.
 * - Máy chủ chặn các thao tác thuộc tính năng Pro khi khách chưa có Pro (danh sách lấy từ brand.json của web app).
 * - AI học trade và AI phân tích của bridge gọi qua máy chủ bằng khoá của chủ app, tính lượt theo gói.
 *
 * Mật khẩu MT5 nằm trong bridge trên máy khách, không đi qua máy chủ.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { planOf, type User } from './auth'
import type { DB } from './db'
import { HttpError, Raw } from './http'
import { KNOWN_PRICES } from './llm'

export interface Job { id: string; method: 'GET' | 'POST'; path: string; body: unknown }
interface Pending { uid: number; resolve: (r: { status: number; body: unknown }) => void; timer: NodeJS.Timeout }

const ONLINE_MS = 45_000

export class Relay {
  private queues = new Map<number, Job[]>()
  private waiters = new Map<number, ((j: Job | null) => void)[]>()
  private pending = new Map<string, Pending>()
  private seen = new Map<number, number>()

  online(uid: number) { return Date.now() - (this.seen.get(uid) ?? 0) < ONLINE_MS }
  lastSeen(uid: number) { return this.seen.get(uid) ?? 0 }

  /** Trình duyệt gửi một yêu cầu cho bridge của mình; chờ bridge làm xong. */
  request(uid: number, method: 'GET' | 'POST', p: string, body: unknown, timeoutMs: number): Promise<{ status: number; body: unknown }> {
    if (!this.online(uid)) throw new HttpError(503, 'Máy chạy MT5 của bạn chưa kết nối. Bật bridge trên máy đó (xem mục Tài khoản & gói → Kết nối máy MT5)')
    const job: Job = { id: randomUUID(), method, path: p, body }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(job.id)
        this.queues.set(uid, (this.queues.get(uid) ?? []).filter((j) => j.id !== job.id))
        resolve({ status: 504, body: { error: 'Máy chạy MT5 không trả lời kịp. Kiểm tra máy đó còn bật và có mạng' } })
      }, timeoutMs)
      this.pending.set(job.id, { uid, resolve, timer })
      const w = this.waiters.get(uid)?.shift()
      if (w) w(job)
      else this.queues.set(uid, [...(this.queues.get(uid) ?? []), job])
    })
  }

  /** Bridge hỏi việc: trả ngay nếu có, không thì giữ kết nối tới waitMs. */
  poll(uid: number, waitMs: number): Promise<Job | null> {
    this.seen.set(uid, Date.now())
    const q = this.queues.get(uid)
    if (q?.length) return Promise.resolve(q.shift()!)
    return new Promise((resolve) => {
      const list = this.waiters.get(uid) ?? []
      const done = (j: Job | null) => { clearTimeout(t); resolve(j) }
      const t = setTimeout(() => {
        this.waiters.set(uid, (this.waiters.get(uid) ?? []).filter((x) => x !== done))
        this.seen.set(uid, Date.now())
        resolve(null)
      }, waitMs)
      list.push(done)
      this.waiters.set(uid, list)
    })
  }

  reply(uid: number, id: string, status: number, body: unknown) {
    const p = this.pending.get(id)
    if (!p || p.uid !== uid) return false
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.resolve({ status, body })
    return true
  }
}

// ---------- mã kết nối của bridge ----------

const hash = (t: string) => createHash('sha256').update(t).digest('hex')

export function ensureTable(db: DB) {
  db.exec('create table if not exists bridge_tokens (user_id integer primary key references users(id) on delete cascade, token_hash text unique not null, created integer not null)')
}

/** Tạo mã mới (mã cũ hết hiệu lực). Chỉ trả mã một lần; máy chủ chỉ giữ bản băm. */
export function newToken(db: DB, uid: number): string {
  const token = `gdb_${randomBytes(24).toString('base64url')}`
  db.prepare('insert into bridge_tokens (user_id, token_hash, created) values (?, ?, ?) on conflict(user_id) do update set token_hash = excluded.token_hash, created = excluded.created')
    .run(uid, hash(token), Date.now())
  return token
}
export const hasToken = (db: DB, uid: number) => !!db.prepare('select 1 from bridge_tokens where user_id = ?').get(uid)

/** Bridge gửi mã trong Authorization: Bearer … (hoặc x-api-key khi gọi AI qua thư viện Anthropic). */
export function userByToken(db: DB, header: string | string[] | undefined, apiKey?: string | string[]): User {
  const raw = String(Array.isArray(header) ? header[0] : header ?? '').replace(/^Bearer\s+/i, '') || String(Array.isArray(apiKey) ? apiKey[0] : apiKey ?? '')
  if (!raw.startsWith('gdb_')) throw new HttpError(401, 'Thiếu mã kết nối của bridge')
  const u = db.prepare('select u.* from bridge_tokens b join users u on u.id = b.user_id where b.token_hash = ?').get(hash(raw)) as User | undefined
  if (!u) throw new HttpError(401, 'Mã kết nối không đúng hoặc đã được tạo lại. Lấy mã mới ở mục Tài khoản & gói')
  return u
}

// ---------- tính năng Pro ----------

const DEFAULT_PRO = ['copier', 'copy-ai']
let cache: { at: number; mtime: number; list: string[] } | null = null

/** Danh sách tính năng Pro do chủ app chọn, đọc từ brand.json của web app (đọc lại khi file đổi). */
export function proFeatures(webDir: string): string[] {
  const f = path.join(webDir, 'brand.json')
  try {
    const mtime = statSync(f).mtimeMs
    if (cache && cache.mtime === mtime && Date.now() - cache.at < 60_000) return cache.list
    const j = JSON.parse(readFileSync(f, 'utf8')) as { proFeatures?: unknown }
    const list = Array.isArray(j.proFeatures) ? j.proFeatures.filter((x): x is string => typeof x === 'string') : DEFAULT_PRO
    cache = { at: Date.now(), mtime, list }
    return list
  } catch { return DEFAULT_PRO }
}

/** Thao tác của bridge thuộc tính năng nào. Chỉ chặn lúc bật/dùng, không chặn tắt. */
export function featureOf(method: string, p: string, body: Record<string, unknown>): string {
  if (method !== 'POST') return ''
  const cfg = (body.config ?? {}) as Record<string, unknown>
  if (p === '/automation/guard') return body.config && cfg.enabled !== false ? 'guard' : ''
  if (p === '/automation/copier') return cfg.enabled ? 'copier' : ''
  if (p === '/ai/analyze') return 'ai'
  if (p.startsWith('/kb/learn') || p === '/kb/source') return 'learn'
  return ''
}

export const FEATURE_NAME: Record<string, string> = { guard: 'Bảo vệ tài khoản', copier: 'Copy lệnh', ai: 'AI phân tích', learn: 'AI học trade' }

/** Bridge đang ở máy chủ hỏi các đường dẫn nội bộ thì không cho chuyển (ví dụ đổi khoá AI trên bridge). */
const BLOCKED = ['/ai/key']
export function checkRelay(u: User, method: string, p: string, body: Record<string, unknown>, pro: string[]) {
  if (!p.startsWith('/') || p.includes('..')) throw new HttpError(400, 'Đường dẫn không hợp lệ')
  if (BLOCKED.includes(p)) throw new HttpError(403, 'Bản web dùng AI của Golden Duck, không cần khoá riêng trên bridge')
  const f = featureOf(method, p, body)
  if (f && pro.includes(f) && planOf(u) !== 'pro') throw new HttpError(402, `${FEATURE_NAME[f] ?? f} là tính năng Pro. Nâng cấp ở trang Gói Pro`)
}

export function timeoutFor(method: string, p: string) {
  if (method === 'GET') return p.startsWith('/candles') || p.startsWith('/history') ? 60_000 : 20_000
  return p.startsWith('/ai/') || p.startsWith('/kb/') || p === '/chat' ? 600_000 : 90_000
}

// ---------- AI của bridge qua máy chủ ----------

const day = () => new Date().toISOString().slice(0, 10)
/** Tính năng AI của bridge → tính năng Pro tương ứng. */
const AI_FEATURE: Record<string, string> = { analyze: 'ai', learn: 'learn' }

export interface ProxyDeps {
  db: DB; perDay: Record<string, number>; pro: string[]; fetch?: typeof fetch
  /** Ô model "mạnh" ở trang Quản trị: nhà cung cấp, model, khoá, địa chỉ, giá (USD mỗi triệu token). */
  slot: { provider: string; model: string; key: string; base: string; priceIn: number; priceOut: number }
}

function aiError(status: number, type: string, message: string) {
  return new Raw(status, { type: 'error', error: { type, message } })
}

type Block = { type: string; text?: string; source?: { type: string; media_type?: string; data?: string }; title?: string }
const OPENAI_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta/openai', deepseek: 'https://api.deepseek.com/v1',
  xai: 'https://api.x.ai/v1', openrouter: 'https://openrouter.ai/api/v1', qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', groq: 'https://api.groq.com/openai/v1',
}

/** Đổi yêu cầu dạng Claude (Messages) sang dạng OpenAI (chat/completions) mà OpenRouter, ChatGPT, Gemini, DeepSeek… đều hiểu. */
export function toOpenAi(body: Record<string, unknown>, model: string, official: boolean) {
  const sys = typeof body.system === 'string' ? body.system : ((body.system as Block[] | undefined) ?? []).map((b) => b.text ?? '').join('\n\n')
  const fmt = (body.output_config as { format?: { type?: string; schema?: unknown } } | undefined)?.format
  const part = (b: Block) => {
    if (b.type === 'text') return { type: 'text', text: b.text ?? '' }
    if (b.type === 'document' && b.source?.type === 'base64') return { type: 'file', file: { filename: `${b.title || 'tai-lieu'}.pdf`, file_data: `data:${b.source.media_type ?? 'application/pdf'};base64,${b.source.data}` } }
    if (b.type === 'document' && b.source?.type === 'text') return { type: 'text', text: String(b.source.data ?? '') }
    if (b.type === 'image' && b.source?.type === 'base64') return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
    return null
  }
  const messages = ((body.messages ?? []) as { role: string; content: string | Block[] }[]).map((m) => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content }
    const parts = m.content.map(part).filter(Boolean) as { type: string; text?: string }[]
    return { role: m.role, content: parts.every((x) => x.type === 'text') ? parts.map((x) => x.text).join('\n\n') : parts }
  })
  const jsonNote = fmt?.type === 'json_schema' ? `\n\nChỉ trả lời bằng đúng một đối tượng JSON theo schema sau, không thêm chữ nào khác:\n${JSON.stringify(fmt.schema)}` : ''
  return {
    model,
    messages: [{ role: official ? 'developer' : 'system', content: sys + jsonNote }, ...messages],
    ...(official ? { max_completion_tokens: body.max_tokens } : { max_tokens: body.max_tokens }),
    ...(fmt?.type === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: { name: 'ket_qua', schema: fmt.schema } } } : {}),
  }
}

/** Đổi câu trả lời dạng OpenAI về dạng Claude để thư viện trên bridge đọc như bình thường. */
export function fromOpenAi(r: Record<string, unknown>, model: string, json: boolean) {
  const ch = ((r.choices ?? []) as { message?: { content?: string; refusal?: string }; finish_reason?: string }[])[0]
  let text = String(ch?.message?.content ?? '').trim()
  if (json) text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')  // nhiều model bọc JSON trong ```
  const u = (r.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number }
  const stop = ch?.message?.refusal || ch?.finish_reason === 'content_filter' ? 'refusal' : ch?.finish_reason === 'length' ? 'max_tokens' : 'end_turn'
  return {
    id: String(r.id ?? 'msg'), type: 'message', role: 'assistant', model: String(r.model ?? model), content: [{ type: 'text', text }],
    stop_reason: stop, stop_sequence: null, usage: { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }
}

/**
 * Nhận yêu cầu dạng API Messages của Claude từ bridge, kiểm tra gói và lượt, rồi gửi bằng khoá và model của chủ app
 * (ô "mạnh" ở trang Quản trị: Claude, OpenRouter, ChatGPT, Gemini…). Lỗi trả theo dạng của Claude để bridge đọc được thông báo.
 */
export async function proxyMessages(d: ProxyDeps, u: User, headers: Record<string, string | string[] | undefined>, body: Record<string, unknown>, query: string): Promise<Raw> {
  const feature = String(headers['x-gd-feature'] ?? '')
  const proId = AI_FEATURE[feature]
  if (proId && d.pro.includes(proId) && planOf(u) !== 'pro') return aiError(403, 'permission_error', `${FEATURE_NAME[proId]} là tính năng Pro. Nâng cấp ở trang Gói Pro`)
  const { slot } = d
  if (!slot.key || !slot.model) return aiError(403, 'permission_error', 'Chủ app chưa bật AI cho AI học trade và AI phân tích (chọn nhà cung cấp, model và dán khoá ở ô "mạnh" trong trang Quản trị)')
  const used = (d.db.prepare('select bridge_calls from ai_usage where user_id = ? and day = ?').get(u.id, day()) as { bridge_calls: number } | undefined)?.bridge_calls ?? 0
  const limit = d.perDay[planOf(u)] ?? 0
  if (used >= limit) return aiError(403, 'permission_error', `Bạn đã dùng hết ${limit} lượt AI phân tích và AI học trade hôm nay${planOf(u) === 'free' ? '. Nâng cấp Pro để có thêm lượt' : '. Mai dùng tiếp'}`)

  const claude = slot.provider === 'anthropic'
  const json = (body.output_config as { format?: { type?: string } } | undefined)?.format?.type === 'json_schema'
  let req: { url: string; headers: Record<string, string>; body: unknown }
  if (claude) {
    const out: Record<string, unknown> = { ...body, model: slot.model }
    const beta = String(headers['anthropic-beta'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    // Haiku không có dự phòng phía máy chủ: bỏ tham số đó nếu chủ app chọn Haiku.
    const keepBeta = /haiku/.test(slot.model) ? beta.filter((b) => !b.startsWith('server-side-fallback')) : beta
    if (/haiku/.test(slot.model)) delete out.fallbacks
    req = { url: `https://api.anthropic.com/v1/messages${query}`, headers: { 'x-api-key': slot.key, 'anthropic-version': String(headers['anthropic-version'] ?? '2023-06-01'), ...(keepBeta.length ? { 'anthropic-beta': keepBeta.join(',') } : {}) }, body: out }
  } else {
    const base = (slot.base || OPENAI_BASE[slot.provider] || '').replace(/\/+$/, '')
    if (!/^https:\/\//.test(base)) return aiError(403, 'permission_error', 'Địa chỉ API của ô "mạnh" phải bắt đầu bằng https://')
    req = { url: `${base}/chat/completions`, headers: { authorization: `Bearer ${slot.key}` }, body: toOpenAi(body, slot.model, slot.provider === 'openai') }
  }
  let res: Response
  try {
    res = await (d.fetch ?? fetch)(req.url, { method: 'POST', headers: { 'content-type': 'application/json', ...req.headers }, body: JSON.stringify(req.body), signal: AbortSignal.timeout(600_000) })
  } catch {
    return aiError(529, 'overloaded_error', 'Máy chủ không gọi được AI. Thử lại sau ít phút')
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } | string }
  if (!res.ok) {
    const msg = typeof j.error === 'string' ? j.error : j.error?.message ?? ''
    console.error('[ai bridge]', slot.provider, res.status, msg)
    // Lỗi khoá hay hết tiền của chủ app thì không nói chi tiết cho khách.
    if (res.status === 401 || res.status === 402 || res.status === 403) return aiError(403, 'permission_error', 'AI của Golden Duck đang gặp lỗi. Báo chủ app kiểm tra khoá và số dư ở trang Quản trị')
    if (res.status === 404) return aiError(400, 'invalid_request_error', `Model ${slot.model} không dùng được (hoặc không đọc được tài liệu PDF). Chủ app chọn model khác ở trang Quản trị`)
    if (res.status === 429) return aiError(529, 'overloaded_error', 'AI đang quá tải. Thử lại sau ít phút')
    return aiError(res.status >= 500 ? 529 : 400, res.status >= 500 ? 'overloaded_error' : 'invalid_request_error', `AI báo lỗi: ${msg.slice(0, 300) || res.status}`)
  }
  const reply = claude ? j : fromOpenAi(j, slot.model, json)
  const us = (reply.usage ?? {}) as Record<string, number>
  const pr = KNOWN_PRICES[String(reply.model)] ?? KNOWN_PRICES[slot.model] ?? [slot.priceIn, slot.priceOut, slot.priceIn / 10, slot.priceIn * 1.25]
  const cost = ((us.input_tokens ?? 0) * pr[0] + (us.output_tokens ?? 0) * pr[1] + (us.cache_read_input_tokens ?? 0) * pr[2] + (us.cache_creation_input_tokens ?? 0) * pr[3]) / 1e6
  d.db.prepare(`insert into ai_usage (user_id, day, cost, tokens_in, tokens_out, bridge_calls) values (?, ?, ?, ?, ?, 1)
    on conflict(user_id, day) do update set cost = cost + excluded.cost, tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out, bridge_calls = bridge_calls + 1`)
    .run(u.id, day(), cost, (us.input_tokens ?? 0) + (us.cache_read_input_tokens ?? 0) + (us.cache_creation_input_tokens ?? 0), us.output_tokens ?? 0)
  return new Raw(200, reply)
}
