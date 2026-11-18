/** Máy chủ giả lập cho bản xem trước: đủ để bấm thử đăng nhập, thêm kênh, nối bot, chat. Không gửi gì ra ngoài. */
import { DUCK_NAME, PERSONA_TEMPLATES, type Persona, type PersonaStore } from './persona'
import { demoMessages } from './signals'
import { ApiError, type ChannelRow, type Me } from './server'

const items: Persona[] = PERSONA_TEMPLATES.map((t) => ({ id: t.id, ...t.p, playbooks: [] })).sort((a) => (a.name === DUCK_NAME ? -1 : 0))
const st = {
  me: null as Me | null,
  channels: [] as ChannelRow[],
  chats: {} as PersonaStore['chats'],
  next: 1,
}
const DEMO_CHANNELS = ['Vàng Signal VIP', 'Gold Sniper', 'FX Daily']
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function user(email: string): Me {
  return { id: 1, email, name: '', plan: 'free', planUntil: null, telegram: { linked: false, name: '', link: 'https://t.me/goldenduck_bot?start=demo' }, limits: { channels: 3, chatPerDay: 15 }, chatToday: 0 }
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
      if (me.chatToday >= me.limits.chatPerDay) throw new ApiError(429, `Bạn đã dùng hết ${me.limits.chatPerDay} tin hôm nay.`)
      await wait(600)
      const id = String(b.persona)
      const now = Date.now()
      const reply = 'Đây là bản xem thử nên mình chưa trả lời thật. Khi chạy trên máy chủ, câu trả lời đến từ AI của Golden Duck.'
      st.chats = { ...st.chats, [id]: [...(st.chats[id] ?? []), { role: 'user', text: String(b.message), at: now }, { role: 'assistant', text: reply, at: now + 1 }] }
      me.chatToday++
      return { items, chats: st.chats, reply, remaining: me.limits.chatPerDay - me.chatToday }
    }
    case '/chat/clear': st.chats = { ...st.chats, [String(b.persona)]: [] }; return { items, chats: st.chats }
  }
  throw new ApiError(404, 'Không có đường dẫn này')
}
