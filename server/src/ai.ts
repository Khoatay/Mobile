/**
 * AI qua máy chủ, nhiều nhà cung cấp.
 * - AI của Golden Duck: chủ app chọn nhà cung cấp, model, dán khoá ở trang quản trị; khách dùng có giới hạn lượt mỗi ngày theo gói.
 * - Khoá riêng: khách dán khoá của mình, chọn model; tính tiền vào khoá của khách nên không giới hạn lượt.
 * - Nhân vật: bộ có sẵn của app, cộng nhân vật khách tự tạo và tự dạy kiến thức.
 * Khoá được mã hoá khi lưu và không bao giờ gửi về máy khách.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { cannedAnswer } from '../../src/lib/faq'
import { BLANK_PERSONA, PERSONA_TEMPLATES, type Persona } from '../../src/lib/persona'
import { planOf, type User } from './auth'
import type { DB } from './db'
import { HttpError } from './http'
import { complete, KNOWN_PRICES, listModels, LlmError, providerOf, PROVIDERS, type LlmCfg, type ProviderId, type Turn } from './llm'
import { maskKey, open, seal } from './secrets'

const CHAT_RULES = `Quy tắc chung, luôn áp dụng bất kể nhân cách:
- Bạn là một trợ lý AI. Nếu người dùng hỏi thẳng bạn có phải người thật không, hãy nói thật.
- Không hứa hẹn lợi nhuận, không khẳng định chắc chắn giá sẽ đi đâu. Phân tích là tham khảo; người dùng tự quyết định và chịu trách nhiệm.
- Không khuyến khích tăng rủi ro để gỡ lỗ, không cổ vũ trade trả thù hay dùng tiền không được phép mất.
- Trả lời bằng ngôn ngữ người dùng đang dùng. Ngắn gọn (thường dưới 200 từ), đi thẳng vào ý, trừ khi được yêu cầu giải thích dài.`

/** Chỉ gửi 10 lượt gần nhất: đủ nhớ mạch chuyện, đỡ tốn tiền. */
const MAX_TURNS = 10
const MAX_KNOWLEDGE = 30_000
const OWN_PER_DAY = 1000
const day = () => new Date().toISOString().slice(0, 10)

/** Nhân vật trên máy chủ có thêm phần kiến thức do người dùng dạy. */
export type SrvPersona = Persona & { knowledge?: string; preset?: boolean }

export const PRESETS: SrvPersona[] = PERSONA_TEMPLATES.map((t) => ({ id: t.id, ...t.p, playbooks: [], preset: true }))

export function systemPrompt(p: SrvPersona): string {
  const parts = [`Bạn là ${p.name}.${p.tagline ? ` ${p.tagline}` : ''}`]
  for (const [title, key] of [['Tính cách', 'personality'], ['Giá trị và phẩm giá, luôn giữ dù người dùng yêu cầu khác', 'values'], ['Cách nói chuyện, xưng hô', 'style'], ['Những điều bạn không làm', 'boundaries'], ['Hội thoại mẫu, để hiểu giọng của bạn', 'examples']] as const) {
    const v = String(p[key] ?? '').trim()
    if (v) parts.push(`## ${title}\n${v}`)
  }
  if (p.knowledge?.trim()) parts.push(`## Kiến thức người dùng dạy bạn (dùng khi liên quan, không bịa thêm ngoài phần này)\n${p.knowledge.trim()}`)
  parts.push(CHAT_RULES, 'Luôn giữ đúng nhân cách ở trên trong mọi câu trả lời.')
  return parts.join('\n\n')
}

// ---------- Cấu hình AI của Golden Duck (chủ app) ----------

/** Hai ô: model rẻ (chat, giải thích: phần lớn lượt dùng) và model mạnh (phân tích sâu; khách Pro chat nếu bật). */
export type Slot = 'cheap' | 'strong'
export interface SlotCfg { provider: ProviderId; model: string; base: string; priceIn: number; priceOut: number }
export interface SystemAi { cheap: SlotCfg; strong: SlotCfg; proStrong: boolean }
const getSetting = <T>(db: DB, k: string, d: T): T => { const r = db.prepare('select value from settings where key = ?').get(k) as { value: string } | undefined; return r ? (JSON.parse(r.value) as T) : d }
const setSetting = (db: DB, k: string, v: unknown) => db.prepare('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(k, JSON.stringify(v))

export interface AiDeps { envKey: string; envModel: string; perDay: Record<string, number>; fetch?: typeof fetch; anthropic?: Pick<Anthropic, 'messages'> }

export function systemAi(db: DB, d: AiDeps): SystemAi {
  const blank = (model: string): SlotCfg => ({ provider: 'anthropic', model, base: '', priceIn: 0, priceOut: 0 })
  const raw = getSetting<Record<string, unknown>>(db, 'ai.system', {})
  // Bản cũ lưu một cấu hình duy nhất: coi là model rẻ.
  if (raw.provider) return { cheap: { ...blank(d.envModel), ...(raw as Partial<SlotCfg>) }, strong: blank('claude-sonnet-5-5'), proStrong: false }
  return { cheap: { ...blank(d.envModel), ...(raw.cheap as object) }, strong: { ...blank('claude-sonnet-5-5'), ...(raw.strong as object) }, proStrong: !!raw.proStrong }
}
/** Khoá của chủ app cho từng nhà cung cấp (dùng chung cho cả hai ô); khoá Claude trong .env dùng khi chưa dán. */
export function systemKey(db: DB, d: AiDeps, provider: string): string {
  const k = open(getSetting(db, `ai.key.${provider}`, ''))
  return k || (provider === 'anthropic' ? d.envKey : '')
}
const slotReady = (db: DB, d: AiDeps, c: SlotCfg) => !!(c.model && (systemKey(db, d, c.provider) || (c.provider === 'anthropic' && d.anthropic)))
export const systemReady = (db: DB, d: AiDeps) => slotReady(db, d, systemAi(db, d).cheap)

export function adminView(db: DB, d: AiDeps) {
  const s = systemAi(db, d)
  const usage = db.prepare('select coalesce(sum(calls),0) as calls, coalesce(sum(cost),0) as cost, coalesce(sum(tokens_in),0) as tin, coalesce(sum(tokens_out),0) as tout, coalesce(sum(own_calls),0) as own from ai_usage where day = ?').get(day())
  const month = db.prepare('select coalesce(sum(calls),0) as calls, coalesce(sum(cost),0) as cost from ai_usage where day >= ?').get(day().slice(0, 8) + '01')
  const canned = getSetting<{ day: string; n: number }>(db, 'ai.canned', { day: '', n: 0 })
  return {
    ...s, ready: { cheap: slotReady(db, d, s.cheap), strong: slotReady(db, d, s.strong) },
    keys: Object.fromEntries(PROVIDERS.map((p) => [p.id, maskKey(systemKey(db, d, p.id))])),
    today: { ...(usage as object), canned: canned.day === day() ? canned.n : 0 }, month,
  }
}

export function adminSave(db: DB, d: AiDeps, b: Record<string, unknown>) {
  const all = systemAi(db, d)
  if (typeof b.proStrong === 'boolean') all.proStrong = b.proStrong
  if (b.slot === 'cheap' || b.slot === 'strong') {
    const cur = all[b.slot]
    const provider = String(b.provider ?? cur.provider) as ProviderId
    if (!providerOf(provider)) throw new HttpError(400, 'Không có nhà cung cấp này')
    const base = provider === 'custom' ? String(b.base ?? cur.base).trim() : ''
    if (provider === 'custom' && !/^https:\/\//.test(base)) throw new HttpError(400, 'Địa chỉ API phải bắt đầu bằng https://')
    const num = (v: unknown, f: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : f }
    const changed = provider !== cur.provider || String(b.model ?? cur.model) !== cur.model
    all[b.slot] = { provider, model: String(b.model ?? cur.model).trim(), base, priceIn: num(b.priceIn, changed ? 0 : cur.priceIn), priceOut: num(b.priceOut, changed ? 0 : cur.priceOut) }
    if (typeof b.key === 'string' && b.key.trim()) setSetting(db, `ai.key.${provider}`, seal(b.key.trim()))
    if (b.clearKey) setSetting(db, `ai.key.${provider}`, '')
  }
  setSetting(db, 'ai.system', all)
  return adminView(db, d)
}

// ---------- Lựa chọn AI của từng khách ----------

interface UserAiRow { mode: 'system' | 'own'; provider: string; model: string; key_enc: string }
const userAiRow = (db: DB, uid: number): UserAiRow => (db.prepare('select mode, provider, model, key_enc from user_ai where user_id = ?').get(uid) as unknown as UserAiRow) ?? { mode: 'system', provider: 'anthropic', model: '', key_enc: '' }

export function myAi(db: DB, d: AiDeps, u: User) {
  const r = userAiRow(db, u.id)
  const s = systemAi(db, d).cheap
  return {
    mode: r.mode, provider: r.provider || 'anthropic', model: r.model, key: maskKey(open(r.key_enc)),
    system: { provider: s.provider, label: providerOf(s.provider)?.label ?? s.provider, model: s.model, ready: systemReady(db, d) },
    providers: PROVIDERS.filter((p) => !p.adminOnly).map(({ id, label, keyUrl, hint }) => ({ id, label, keyUrl, hint })),
  }
}

export function saveMyAi(db: DB, d: AiDeps, u: User, b: Record<string, unknown>, advanced: boolean) {
  const cur = userAiRow(db, u.id)
  const mode = b.mode === 'own' ? 'own' : 'system'
  if (mode === 'own' && !advanced) throw new HttpError(403, 'Dùng khoá AI riêng có ở gói Pro')
  const provider = String(b.provider ?? cur.provider)
  const p = providerOf(provider)
  if (!p || p.adminOnly) throw new HttpError(400, 'Không có nhà cung cấp này')
  // Đổi nhà cung cấp thì khoá cũ không dùng được nữa.
  let keyEnc = provider === cur.provider ? cur.key_enc : ''
  if (typeof b.key === 'string' && b.key.trim()) keyEnc = seal(b.key.trim())
  if (b.clearKey) keyEnc = ''
  const model = String(b.model ?? (provider === cur.provider ? cur.model : '')).trim()
  if (mode === 'own' && !keyEnc) throw new HttpError(400, 'Dán khoá AI của bạn trước')
  if (mode === 'own' && !model) throw new HttpError(400, 'Chọn model trước')
  db.prepare('insert into user_ai (user_id, mode, provider, model, key_enc) values (?, ?, ?, ?, ?) on conflict(user_id) do update set mode = excluded.mode, provider = excluded.provider, model = excluded.model, key_enc = excluded.key_enc')
    .run(u.id, mode, provider, model, keyEnc)
  return myAi(db, d, u)
}

/** Khoá và model dùng cho lần chat này. Khoá riêng chỉ có hiệu lực khi còn quyền nâng cao (Pro hết hạn thì về AI của Golden Duck). */
function cfgFor(db: DB, d: AiDeps, u: User, advanced: boolean): LlmCfg & { own: boolean; priceIn: number; priceOut: number } {
  const r = userAiRow(db, u.id)
  if (r.mode === 'own' && advanced) return { provider: r.provider as ProviderId, model: r.model, key: open(r.key_enc), own: true, priceIn: 0, priceOut: 0 }
  const s = systemAi(db, d)
  return slotCfg(db, d, planOf(u) === 'pro' && s.proStrong && slotReady(db, d, s.strong) ? 'strong' : 'cheap')
}
function slotCfg(db: DB, d: AiDeps, slot: Slot) {
  const c = systemAi(db, d)[slot]
  return { provider: c.provider, model: c.model, key: systemKey(db, d, c.provider), base: c.base, own: false, priceIn: c.priceIn, priceOut: c.priceOut }
}

/** Danh sách model: khoá vừa dán (chưa lưu), hoặc khoá đã lưu của khách / của hệ thống. */
export async function models(db: DB, d: AiDeps, u: User, b: Record<string, unknown>, admin: boolean) {
  const provider = String(b.provider ?? '') as ProviderId
  const p = providerOf(provider)
  if (!p || (p.adminOnly && !admin)) throw new HttpError(400, 'Không có nhà cung cấp này')
  let key = typeof b.key === 'string' ? b.key.trim() : ''
  if (!key) key = (b.scope === 'system' || b.scope === 'cheap' || b.scope === 'strong') && admin ? systemKey(db, d, provider) : (() => { const r = userAiRow(db, u.id); return r.provider === provider ? open(r.key_enc) : '' })()
  const base = provider === 'custom' ? String(b.base ?? systemAi(db, d)[b.slot === 'strong' ? 'strong' : 'cheap'].base) : undefined
  try { return { models: await listModels({ provider, key, base }, d.fetch) } }
  catch (e) { if (e instanceof LlmError) throw new HttpError(400, e.message); throw e }
}

// ---------- Nhân vật ----------

export function personas(db: DB, uid: number): SrvPersona[] {
  const mine = (db.prepare('select data from personas where user_id = ? order by updated').all(uid) as { data: string }[]).map((r) => JSON.parse(r.data) as SrvPersona)
  return [...PRESETS, ...mine]
}
export function savePersona(db: DB, uid: number, b: Record<string, unknown>, advanced: boolean) {
  if (!advanced) throw new HttpError(403, 'Tạo nhân vật riêng có ở gói Pro')
  const mine = db.prepare('select count(*) as n from personas where user_id = ?').get(uid) as { n: number }
  const id = typeof b.id === 'string' && b.id && !PRESETS.some((p) => p.id === b.id) ? b.id : ''
  if (id && !db.prepare('select 1 from personas where id = ? and user_id = ?').get(id, uid)) throw new HttpError(404, 'Không có nhân vật này')
  if (!id && mine.n >= 20) throw new HttpError(403, 'Tối đa 20 nhân vật tự tạo')
  const str = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max)
  const name = str('name', 60)
  if (!name) throw new HttpError(400, 'Đặt tên cho nhân vật')
  const knowledge = str('knowledge', MAX_KNOWLEDGE)
  const p: SrvPersona = {
    ...BLANK_PERSONA, id: id || `u-${randomUUID()}`, name, avatar: '', tagline: str('tagline', 120), personality: str('personality', 3000), values: str('values', 3000),
    style: str('style', 2000), boundaries: str('boundaries', 2000), greeting: str('greeting', 500), examples: str('examples', 4000), knowledge, use_account: false,
  }
  db.prepare('insert into personas (id, user_id, data, updated) values (?, ?, ?, ?) on conflict(id) do update set data = excluded.data, updated = excluded.updated').run(p.id, uid, JSON.stringify(p), Date.now())
  return { ...store(db, uid), saved: p.id }
}
export function deletePersona(db: DB, uid: number, id: string) {
  db.prepare('delete from personas where id = ? and user_id = ?').run(id, uid)
  db.prepare('delete from chats where user_id = ? and persona = ?').run(uid, id)
  return store(db, uid)
}

// ---------- Chat ----------

export function usageToday(db: DB, userId: number) {
  return (db.prepare('select calls, cost, own_calls from ai_usage where user_id = ? and day = ?').get(userId, day()) as { calls: number; cost: number; own_calls: number } | undefined) ?? { calls: 0, cost: 0, own_calls: 0 }
}
export const limitFor = (u: User, perDay: Record<string, number>) => perDay[planOf(u)] ?? 0

export function store(db: DB, userId: number) {
  const rows = db.prepare('select persona, role, text, at from chats where user_id = ? order by id').all(userId) as { persona: string; role: 'user' | 'assistant'; text: string; at: number }[]
  const chats: Record<string, { role: 'user' | 'assistant'; text: string; at: number }[]> = {}
  for (const r of rows) (chats[r.persona] ??= []).push({ role: r.role, text: r.text, at: r.at })
  return { items: personas(db, userId), chats }
}

export async function chat(db: DB, u: User, d: AiDeps, body: { persona?: unknown; message?: unknown }, advanced: boolean) {
  const p = personas(db, u.id).find((x) => x.id === String(body.persona))
  if (!p) throw new HttpError(400, 'Không có nhân vật này')
  const message = String(body.message ?? '').trim().slice(0, 4000)
  if (!message) throw new HttpError(400, 'Tin nhắn đang trống')
  const now = Date.now()
  const saveTurns = (reply: string) => db.prepare('insert into chats (user_id, persona, role, text, at) values (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)').run(u.id, p.id, 'user', message, now, u.id, p.id, 'assistant', reply, now + 1)

  // Câu hỏi cơ bản của người mới: trả lời soạn sẵn, không gọi AI, không tính lượt. Nhân vật tự tạo thì luôn để AI trả lời theo giọng riêng.
  const canned = p.preset ? cannedAnswer(message) : null
  if (canned) {
    saveTurns(canned)
    const c = getSetting<{ day: string; n: number }>(db, 'ai.canned', { day: '', n: 0 })
    setSetting(db, 'ai.canned', { day: day(), n: c.day === day() ? c.n + 1 : 1 })
    const own = userAiRow(db, u.id).mode === 'own' && advanced
    return { reply: canned, ...store(db, u.id), remaining: own ? null : Math.max(0, limitFor(u, d.perDay) - usageToday(db, u.id).calls), own, canned: true }
  }

  const cfg = cfgFor(db, d, u, advanced)
  const used = usageToday(db, u.id)
  const limit = cfg.own ? OWN_PER_DAY : limitFor(u, d.perDay)
  if (!cfg.own && !systemReady(db, d)) throw new HttpError(503, 'AI của Golden Duck chưa được bật. Bạn có thể dùng khoá AI riêng ở mục Tài khoản')
  if ((cfg.own ? used.own_calls : used.calls) >= limit)
    throw new HttpError(429, cfg.own ? 'Đã tới giới hạn an toàn 1000 tin mỗi ngày' : `Bạn đã dùng hết ${limit} tin hôm nay. Mai dùng tiếp, hoặc dùng khoá AI riêng ở mục Tài khoản để không bị giới hạn${planOf(u) === 'free' ? ', hoặc nâng cấp Pro' : ''}.`)

  const history = (db.prepare('select role, text from chats where user_id = ? and persona = ? order by id desc limit ?').all(u.id, p.id, MAX_TURNS) as { role: 'user' | 'assistant'; text: string }[]).reverse()
  const turns: Turn[] = []
  for (const h of history) {
    const last = turns[turns.length - 1]
    if (last && last.role === h.role) last.content += `\n\n${h.text}`
    else turns.push({ role: h.role, content: h.text })
  }
  if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', content: '(bắt đầu cuộc trò chuyện)' })
  if (turns[turns.length - 1]?.role === 'user') turns[turns.length - 1].content += `\n\n${message}`
  else turns.push({ role: 'user', content: message })

  let res
  try { res = await complete(cfg, systemPrompt(p), turns, 2000, d.fetch, cfg.own ? undefined : d.anthropic) }
  catch (e) {
    if (e instanceof LlmError) {
      if (!cfg.own) console.error('[ai]', e.kind, e.message)
      // Lỗi khoá của hệ thống thì không nói chi tiết cho khách.
      throw new HttpError(e.kind === 'quota' ? 429 : 502, cfg.own ? e.message : e.kind === 'quota' ? 'AI đang quá tải. Thử lại sau ít phút' : 'AI đang gặp lỗi. Thử lại sau')
    }
    throw e
  }
  const reply = res.refused ? 'Mình không thể trả lời câu này.' : res.text || '…'
  const pr = KNOWN_PRICES[res.model] ?? KNOWN_PRICES[cfg.model] ?? [cfg.priceIn, cfg.priceOut, cfg.priceIn / 10, cfg.priceIn * 1.25]
  const cost = cfg.own ? 0 : (res.usage.in * pr[0] + res.usage.out * pr[1] + res.usage.cacheRead * pr[2] + res.usage.cacheWrite * pr[3]) / 1e6
  saveTurns(reply)
  db.prepare(`insert into ai_usage (user_id, day, calls, cost, tokens_in, tokens_out, own_calls) values (?, ?, ?, ?, ?, ?, ?)
    on conflict(user_id, day) do update set calls = calls + excluded.calls, cost = cost + excluded.cost, tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out, own_calls = own_calls + excluded.own_calls`)
    .run(u.id, day(), cfg.own ? 0 : 1, cost, cfg.own ? 0 : res.usage.in + res.usage.cacheRead + res.usage.cacheWrite, cfg.own ? 0 : res.usage.out, cfg.own ? 1 : 0)
  return { reply, ...store(db, u.id), remaining: cfg.own ? null : Math.max(0, limit - used.calls - 1), own: cfg.own }
}

/** Thử khoá: một câu rất ngắn. */
export async function testAi(db: DB, d: AiDeps, u: User, scope: 'me' | Slot, advanced: boolean) {
  const cfg = scope === 'me' ? cfgFor(db, d, u, advanced) : slotCfg(db, d, scope)
  try {
    const r = await complete(cfg, 'Trả lời đúng một từ.', [{ role: 'user', content: 'Nói "OK".' }], 20, d.fetch, cfg.own ? undefined : d.anthropic)
    return { ok: true, reply: r.text.slice(0, 50), model: r.model, provider: cfg.provider }
  } catch (e) { if (e instanceof LlmError) throw new HttpError(400, e.message); throw e }
}
