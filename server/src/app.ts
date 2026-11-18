/** Ghép mọi phần thành danh sách đường dẫn API. Tách khỏi index.ts để kiểm thử không cần mở cổng. */
import * as auth from './auth'
import { type User } from './auth'
import * as ai from './ai'
import type { Bot } from './bot'
import * as ch from './channels'
import type { DB } from './db'
import { HttpError, type Handler, type Req } from './http'

export interface AppDeps {
  db: DB
  reader: ch.Reader & { error?: string }
  bot: Pick<Bot, 'username' | 'send' | 'configured'> & { error?: string }
  ai: ai.AiDeps
  adminEmails?: string[]
  channelsMax: Record<string, number>
  secure: boolean
}

const COOKIE = 'gd_session'

/** Tin mới của một kênh: lưu, đọc lệnh, báo khách bật thông báo (trừ khi đang nạp tin cũ lúc mới tham gia). */
export function onChannelMessage(d: Pick<AppDeps, 'db' | 'bot'>, channelId: number, m: { id: number; date: number; text: string }, quiet = false) {
  const s = ch.storeMessage(d.db, channelId, m)
  if (!s || quiet) return
  // Tin quá cũ (máy chủ vừa nối lại) thì không báo.
  if (Date.now() / 1000 - m.date > 600) return
  const text = ch.signalText(s)
  for (const u of ch.subscribersToNotify(d.db, channelId)) void d.bot.send(u.tg_chat, text)
}

export function routes(d: AppDeps): Record<string, Handler> {
  const me = (r: Req): User => {
    const u = auth.userBySession(d.db, r.cookies[COOKIE])
    if (!u) throw new HttpError(401, 'Bạn cần đăng nhập')
    return u
  }
  const isAdmin = (u: User) => u.id === 1 || (d.adminEmails ?? []).includes(u.email)
  const admin = (r: Req) => { const u = me(r); if (!isAdmin(u)) throw new HttpError(403, 'Chỉ chủ app làm được việc này'); return u }
  const view = (u: User) => ({
    id: u.id, email: u.email, name: u.name, plan: auth.planOf(u), planUntil: u.plan_until, admin: isAdmin(u),
    telegram: { linked: !!u.tg_chat, name: u.tg_name, link: d.bot.username ? `https://t.me/${d.bot.username}?start=${u.link_code}` : '' },
    limits: { channels: d.channelsMax[auth.planOf(u)] ?? 0, chatPerDay: ai.limitFor(u, d.ai.perDay) },
    chatToday: ai.usageToday(d.db, u.id).calls,
  })
  const start = (r: Req, u: User) => {
    r.setCookie(COOKIE, auth.createSession(d.db, u.id), { maxAge: auth.SESSION_DAYS * 86_400, secure: d.secure })
    return view(u)
  }
  const channelId = (r: Req) => { const n = Number(r.body.id); if (!Number.isInteger(n)) throw new HttpError(400, 'Thiếu kênh'); return n }

  return {
    'GET /api/health': () => ({ ok: true, telegram: d.reader.ready(), telegramError: d.reader.ready() ? '' : d.reader.error ?? '', bot: d.bot.username || '', ai: ai.systemReady(d.db, d.ai) }),

    'POST /api/auth/register': (r) => { auth.checkRate(r.ip); return start(r, auth.register(d.db, r.body)) },
    'POST /api/auth/login': (r) => {
      auth.checkRate(r.ip)
      try { return start(r, auth.login(d.db, r.body)) } catch (e) { auth.noteFail(r.ip); throw e }
    },
    'POST /api/auth/logout': (r) => { auth.endSession(d.db, r.cookies[COOKIE]); r.setCookie(COOKIE, '', { maxAge: 0, secure: d.secure }); return { ok: true } },
    'GET /api/me': (r) => view(me(r)),
    'POST /api/me/telegram/unlink': (r) => { const u = me(r); d.db.prepare("update users set tg_chat = null, tg_name = '' where id = ?").run(u.id); return view(auth.getUser(d.db, u.id)!) },

    'GET /api/channels': (r) => ch.listMine(d.db, me(r).id),
    'POST /api/channels/add': async (r) => {
      const u = me(r)
      return ch.addChannel(d.db, d.reader, u.id, String(r.body.ref ?? ''), d.channelsMax[auth.planOf(u)] ?? 0, (id, m, quiet) => onChannelMessage(d, id, m, quiet))
    },
    'POST /api/channels/remove': (r) => ch.removeChannel(d.db, me(r).id, channelId(r)),
    'POST /api/channels/notify': (r) => ch.setNotify(d.db, me(r).id, channelId(r), !!r.body.on),
    'GET /api/messages': (r) => ch.feed(d.db, me(r).id, Number(r.query.get('after')) || 0),

    'GET /api/personas': (r) => ai.store(d.db, me(r).id),
    'POST /api/personas/save': (r) => ai.savePersona(d.db, me(r).id, r.body),
    'POST /api/personas/delete': (r) => ai.deletePersona(d.db, me(r).id, String(r.body.id ?? '')),
    'GET /api/ai/me': (r) => ai.myAi(d.db, d.ai, me(r)),
    'POST /api/ai/me': (r) => ai.saveMyAi(d.db, d.ai, me(r), r.body),
    'POST /api/ai/models': (r) => { const u = me(r); return ai.models(d.db, d.ai, u, r.body, isAdmin(u)) },
    'POST /api/ai/test': (r) => { const u = me(r); return ai.testAi(d.db, d.ai, u, r.body.scope === 'system' && isAdmin(u) ? 'system' : 'me') },
    'GET /api/admin/ai': (r) => { admin(r); return ai.adminView(d.db, d.ai) },
    'POST /api/admin/ai': (r) => { admin(r); return ai.adminSave(d.db, d.ai, r.body) },
    'POST /api/chat': (r) => ai.chat(d.db, me(r), d.ai, r.body),
    'POST /api/chat/clear': (r) => {
      const u = me(r)
      d.db.prepare('delete from chats where user_id = ? and persona = ?').run(u.id, String(r.body.persona ?? ''))
      return ai.store(d.db, u.id)
    },
  }
}
