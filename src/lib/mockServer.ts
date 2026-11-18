/** Máy chủ giả lập cho bản xem trước: đủ để bấm thử đăng nhập, thêm kênh, nối bot, chat. Không gửi gì ra ngoài. */
import { DUCK_NAME, PERSONA_TEMPLATES, type Persona, type PersonaStore } from './persona'
import { demoMessages } from './signals'
import { cannedAnswer } from './faq'
import { ApiError, type ChannelRow, type Me } from './server'

let items: (Persona & { knowledge?: string; preset?: boolean })[] = PERSONA_TEMPLATES.map((t) => ({ id: t.id, ...t.p, playbooks: [], preset: true })).sort((a) => (a.name === DUCK_NAME ? -1 : 0))
const st = {
  me: null as Me | null,
  channels: [] as ChannelRow[],
  chats: {} as PersonaStore['chats'],
  next: 1,
  ai: { mode: 'system' as 'system' | 'own', provider: 'anthropic', model: '', key: '' },
  sys: { cheap: { provider: 'anthropic', model: 'claude-haiku-5-5', base: '', priceIn: 0, priceOut: 0 }, strong: { provider: 'anthropic', model: 'claude-sonnet-5-5', base: '', priceIn: 0, priceOut: 0 }, proStrong: false, keys: { anthropic: '…demo' } as Record<string, string> },
  canned: 0,
}
const PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)', keyUrl: 'console.anthropic.com', hint: 'Khoá bắt đầu bằng sk-ant-' },
  { id: 'openai', label: 'ChatGPT (OpenAI)', keyUrl: 'platform.openai.com/api-keys', hint: 'Khoá bắt đầu bằng sk-' },
  { id: 'gemini', label: 'Gemini (Google)', keyUrl: 'aistudio.google.com/apikey', hint: 'Khoá bắt đầu bằng AIza' },
  { id: 'deepseek', label: 'DeepSeek', keyUrl: 'platform.deepseek.com', hint: '' },
  { id: 'xai', label: 'Grok (xAI)', keyUrl: 'console.x.ai', hint: '' },
  { id: 'openrouter', label: 'OpenRouter (hàng trăm model)', keyUrl: 'openrouter.ai/keys', hint: 'Một khoá dùng được model của nhiều hãng' },
  { id: 'qwen', label: 'Qwen (Alibaba)', keyUrl: 'dashscope.console.aliyun.com', hint: '' },
  { id: 'groq', label: 'Groq', keyUrl: 'console.groq.com/keys', hint: '' },
]
const DEMO_MODELS: Record<string, string[]> = {
  anthropic: ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'], openai: ['mô-hình-mẫu-1', 'mô-hình-mẫu-2'], gemini: ['mô-hình-mẫu-flash', 'mô-hình-mẫu-pro'],
}
const myAi = () => ({ ...st.ai, key: st.ai.key ? '…' + st.ai.key.slice(-4) : '', system: { provider: st.sys.cheap.provider, label: PROVIDERS.find((p) => p.id === st.sys.cheap.provider)?.label ?? '', model: st.sys.cheap.model, ready: true }, providers: PROVIDERS })
const adminAi = () => ({ ...st.sys, ready: { cheap: true, strong: true }, today: { calls: 12, cost: 0.0042, tin: 9000, tout: 2100, own: 3, canned: st.canned }, month: { calls: 340, cost: 0.12 } })
const DEMO_CHANNELS = ['Vàng Signal VIP', 'Gold Sniper', 'FX Daily']
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function user(email: string): Me {
  return { id: 1, admin: true, advanced: true, email, name: '', plan: 'free', planUntil: null, telegram: { linked: false, name: '', link: 'https://t.me/goldenduck_bot?start=demo' }, limits: { channels: 3, chatPerDay: 15 }, chatToday: 0 }
}
const need = () => { if (!st.me) throw new ApiError(401, 'Bạn cần đăng nhập'); return st.me }

export async function mockApi(path: string, body?: unknown): Promise<unknown> {
  await wait(250)
  const b = (body ?? {}) as Record<string, unknown>
  const [p, q] = path.split('?')
  switch (p) {
    case '/health': return { ok: true, telegram: true, telegramError: '', bot: 'goldenduck_bot', ai: true }
    case '/auth/register':
    case '/auth/login': {
      const email = String(b.email ?? '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ApiError(400, 'Email không hợp lệ')
      if (String(b.password ?? '').length < 8) throw new ApiError(400, 'Mật khẩu cần ít nhất 8 ký tự')
      st.me = user(email)
      return st.me
    }
    case '/auth/logout': st.me = null; return { ok: true }
    case '/me': return need()
    case '/bridge/status': need(); return { online: true, lastSeen: Date.now(), hasToken: true, telegram: true, outages: [{ start: Date.now() - 26 * 3_600_000, end: Date.now() - 25.6 * 3_600_000 }] }
    case '/bridge/token': need(); return { token: 'gdb_ban_xem_truoc_khong_dung_that' }
    case '/me/telegram/unlink': need().telegram = { ...need().telegram, linked: false, name: '' }; return need()
    case '/me/telegram/demo-link': need().telegram = { ...need().telegram, linked: true, name: 'Bạn' }; return need()
    case '/channels': need(); return st.channels
    case '/channels/add': {
      const me = need()
      const raw = String(b.ref ?? '').trim()
      const m = raw.match(/(?:t\.me\/(?:s\/)?)?@?([\w+-]{4,})\/?$/i)
      if (!m) throw new ApiError(400, 'Không nhận ra kênh. Dán @tên kênh, link t.me/tên, hoặc link mời t.me/+…')
      if (st.channels.length >= me.limits.channels) throw new ApiError(403, `Gói của bạn theo dõi được tối đa ${me.limits.channels} kênh. Xoá bớt kênh hoặc nâng cấp gói`)
      if (st.channels.some((c) => c.ref === m[1].toLowerCase())) throw new ApiError(409, 'Bạn đã thêm kênh này rồi')
      await wait(700)
      const title = DEMO_CHANNELS[st.channels.length % DEMO_CHANNELS.length]
      st.channels.push({ id: st.next++, ref: m[1].toLowerCase(), kind: m[1].startsWith('+') ? 'invite' : 'public', title, status: 'ok', error: '', last_at: Date.now(), notify: 1, messages: 12 })
      return st.channels
    }
    case '/channels/remove': st.channels = st.channels.filter((c) => c.id !== b.id); return st.channels
    case '/channels/notify': st.channels = st.channels.map((c) => (c.id === b.id ? { ...c, notify: b.on ? 1 : 0 } : c)); return st.channels
    case '/messages': {
      need()
      const after = Number(new URLSearchParams(q).get('after')) || 0
      const titles = st.channels.map((c) => c.title)
      // Tin mẫu của app, gán vào các kênh khách đã thêm.
      return demoMessages(Date.now()).filter((x) => x.date > after && titles.length).map((x, i) => ({ ...x, channel: titles[i % titles.length] }))
    }
    case '/personas': need(); return { items, chats: st.chats }
    case '/chat': {
      const me = need()
      if (st.ai.mode !== 'own' && me.chatToday >= me.limits.chatPerDay) throw new ApiError(429, `Bạn đã dùng hết ${me.limits.chatPerDay} tin hôm nay.`)
      await wait(600)
      const id = String(b.persona)
      const now = Date.now()
      const canned = items.find((x) => x.id === id)?.preset ? cannedAnswer(String(b.message)) : null
      if (canned) {
        st.canned++
        st.chats = { ...st.chats, [id]: [...(st.chats[id] ?? []), { role: 'user', text: String(b.message), at: now }, { role: 'assistant', text: canned, at: now + 1 }] }
        return { items, chats: st.chats, reply: canned, remaining: me.limits.chatPerDay - me.chatToday, canned: true }
      }
      const reply = 'Đây là bản xem thử nên mình chưa trả lời thật. Khi chạy trên máy chủ, câu trả lời đến từ AI của Golden Duck.'
      st.chats = { ...st.chats, [id]: [...(st.chats[id] ?? []), { role: 'user', text: String(b.message), at: now }, { role: 'assistant', text: reply, at: now + 1 }] }
      if (st.ai.mode !== 'own') me.chatToday++
      return { items, chats: st.chats, reply, remaining: st.ai.mode === 'own' ? null : me.limits.chatPerDay - me.chatToday, own: st.ai.mode === 'own' }
    }
    case '/personas/save': {
      need()
      const name = String(b.name ?? '').trim()
      if (!name) throw new ApiError(400, 'Đặt tên cho nhân vật')
      const id = typeof b.id === 'string' && b.id ? b.id : `u-${Date.now()}`
      const p = { ...PERSONA_TEMPLATES[0].p, ...(b as object), id, name, avatar: '', playbooks: [], use_account: false, preset: false } as (typeof items)[number]
      items = items.some((x) => x.id === id) ? items.map((x) => (x.id === id ? p : x)) : [...items, p]
      return { items, chats: st.chats, saved: id }
    }
    case '/personas/delete': items = items.filter((x) => x.id !== b.id || x.preset); return { items, chats: st.chats }
    case '/ai/me':
      need()
      if (body !== undefined) {
        if (b.mode === 'own' && !(b.key || st.ai.key)) throw new ApiError(400, 'Dán khoá AI của bạn trước')
        if (b.provider && b.provider !== st.ai.provider) st.ai.key = ''
        st.ai = { mode: b.mode === 'own' ? 'own' : 'system', provider: String(b.provider ?? st.ai.provider), model: String(b.model ?? st.ai.model), key: String(b.key || st.ai.key) }
      }
      return myAi()
    case '/ai/models': await wait(500); return { models: DEMO_MODELS[String(b.provider)] ?? ['mô-hình-mẫu'] }
    case '/ai/test': await wait(500); return { ok: true, reply: 'OK', model: b.scope === 'strong' ? st.sys.strong.model : b.scope === 'cheap' ? st.sys.cheap.model : st.ai.model }
    case '/admin/ai':
      need()
      if (body !== undefined) {
        if (typeof b.proStrong === 'boolean') st.sys.proStrong = b.proStrong
        const slot = b.slot === 'strong' ? 'strong' : b.slot === 'cheap' ? 'cheap' : null
        if (slot) {
          const c = st.sys[slot]
          st.sys[slot] = { ...c, ...(b.provider ? { provider: String(b.provider) } : {}), ...(b.model ? { model: String(b.model) } : {}), ...(b.priceIn != null ? { priceIn: Number(b.priceIn), priceOut: Number(b.priceOut) } : {}) }
          if (b.key) st.sys.keys = { ...st.sys.keys, [st.sys[slot].provider]: '…' + String(b.key).slice(-4) }
        }
      }
      return adminAi()
    case '/admin/plan': need(); return { ok: true, email: String(b.email), plan: Number(b.days) ? 'pro' : 'free', until: Number(b.days) ? Date.now() + Number(b.days) * 86_400_000 : null }
    case '/chat/clear': st.chats = { ...st.chats, [String(b.persona)]: [] }; return { items, chats: st.chats }
  }
  throw new ApiError(404, 'Không có đường dẫn này')
}
