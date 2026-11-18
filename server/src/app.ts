/** Ghép mọi phần thành danh sách đường dẫn API. Tách khỏi index.ts để kiểm thử không cần mở cổng. */
import * as auth from './auth'
import { type User } from './auth'
import * as ai from './ai'
import type { Bot } from './bot'
import * as ch from './channels'
import type { DB } from './db'
import { HttpError, type Handler, type Req } from './http'
import * as relay from './relay'

export interface AppDeps {
  db: DB
  reader: ch.Reader & { error?: string }
  bot: Pick<Bot, 'username' | 'send' | 'configured'> & { error?: string }
  ai: ai.AiDeps
  adminEmails?: string[]
  channelsMax: Record<string, number>
  secure: boolean
  /** Nối bridge trên máy khách. */
  relay: relay.Relay
  /** Thư mục web app, để đọc danh sách tính năng Pro trong brand.json. */
  webDir: string
  bridgeAiPerDay: Record<string, number>
  /** Thời gian giữ kết nối khi bridge hỏi việc (kiểm thử đặt ngắn). */
  pollMs?: number
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
  /** Tính năng nâng cao (khoá AI riêng, nhân vật tự tạo): khách Pro và chủ app. */
  const adv = (u: User) => isAdmin(u) || auth.planOf(u) === 'pro'
  const admin = (r: Req) => { const u = me(r); if (!isAdmin(u)) throw new HttpError(403, 'Chỉ chủ app làm được việc này'); return u }
  const view = (u: User) => ({
    id: u.id, email: u.email, name: u.name, plan: auth.planOf(u), planUntil: u.plan_until, admin: isAdmin(u), advanced: adv(u),
    telegram: { linked: !!u.tg_chat, name: u.tg_name, link: d.bot.username ? `https://t.me/${d.bot.username}?start=${u.link_code}` : '' },
    limits: { channels: d.channelsMax[auth.planOf(u)] ?? 0, chatPerDay: ai.limitFor(u, d.ai.perDay) },
    chatToday: ai.usageToday(d.db, u.id).calls,
  })
  const start = (r: Req, u: User) => {
    r.setCookie(COOKIE, auth.createSession(d.db, u.id), { maxAge: auth.SESSION_DAYS * 86_400, secure: d.secure })
    return view(u)
  }
  relay.ensureTable(d.db)
  const bridgeUser = (r: Req) => relay.userByToken(d.db, r.headers.authorization, r.headers['x-api-key'])
  const relayed = async (r: Req, method: 'GET' | 'POST', p: string, body: Record<string, unknown>) => {
    const u = me(r)
    relay.checkRelay(u, method, p, body, relay.proFeatures(d.webDir))
    const out = await d.relay.request(u.id, method, p, body, relay.timeoutFor(method, p))
    if (out.status >= 400) throw new HttpError(out.status, String((out.body as { error?: string })?.error ?? `Lỗi ${out.status} từ bridge`))
    return out.body
  }
  const channelId = (r: Req) => { const n = Number(r.body.id); if (!Number.isInteger(n)) throw new HttpError(400, 'Thiếu kênh'); return n }

  return {
    // ---------- bridge trên máy khách ----------
    'POST /api/bridge/token': (r) => ({ token: relay.newToken(d.db, me(r).id) }),
    'GET /api/bridge/status': (r) => { const u = me(r); return { online: d.relay.online(u.id), lastSeen: d.relay.lastSeen(u.id), hasToken: relay.hasToken(d.db, u.id) } },
    'GET /api/bridge/me': (r) => { const u = bridgeUser(r); return { email: u.email, plan: auth.planOf(u) } },
    'POST /api/bridge/poll': async (r) => (await d.relay.poll(bridgeUser(r).id, d.pollMs ?? 25_000)) ?? { id: '' },
    'POST /api/bridge/reply': (r) => ({ ok: d.relay.reply(bridgeUser(r).id, String(r.body.id), Number(r.body.status) || 200, r.body.body) }),
    'GET /api/relay': (r) => relayed(r, 'GET', r.query.get('p') ?? '', {}),
    'POST /api/relay': (r) => relayed(r, 'POST', String(r.body.path ?? ''), (r.body.body ?? {}) as Record<string, unknown>),
    'POST /api/bridge/anthropic/v1/messages': (r) => {
      const u = bridgeUser(r)
      // Dùng ô "mạnh" ở trang Quản trị, nhà cung cấp nào cũng được (Claude, OpenRouter, ChatGPT, Gemini…).
      const strong = ai.systemAi(d.db, d.ai).strong
      return relay.proxyMessages({
        db: d.db, perDay: d.bridgeAiPerDay, pro: relay.proFeatures(d.webDir), fetch: d.ai.fetch,
        slot: { ...strong, key: ai.systemKey(d.db, d.ai, strong.provider) },
      }, u, r.headers, r.body, r.query.toString() ? `?${r.query.toString()}` : '')
    },

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
    'POST /api/personas/save': (r) => { const u = me(r); return ai.savePersona(d.db, u.id, r.body, adv(u)) },
    'POST /api/personas/delete': (r) => ai.deletePersona(d.db, me(r).id, String(r.body.id ?? '')),
    'GET /api/ai/me': (r) => ai.myAi(d.db, d.ai, me(r)),
    'POST /api/ai/me': (r) => { const u = me(r); return ai.saveMyAi(d.db, d.ai, u, r.body, adv(u)) },
    'POST /api/ai/models': (r) => { const u = me(r); return ai.models(d.db, d.ai, u, r.body, isAdmin(u)) },
    'POST /api/ai/test': (r) => {
      const u = me(r)
      const scope = isAdmin(u) && (r.body.scope === 'cheap' || r.body.scope === 'strong') ? r.body.scope : 'me'
      return ai.testAi(d.db, d.ai, u, scope, adv(u))
    },
    'GET /api/admin/ai': (r) => { admin(r); return ai.adminView(d.db, d.ai) },
    'POST /api/admin/ai': (r) => { admin(r); return ai.adminSave(d.db, d.ai, r.body) },
    /** Nâng khách lên Pro bằng tay (trước khi có thanh toán). days = 0 thì về Free. */
    'POST /api/admin/plan': (r) => {
      admin(r)
      const email = auth.normEmail(r.body.email)
      const days = Math.max(0, Math.min(3650, Number(r.body.days) || 0))
      const res = d.db.prepare('update users set plan = ?, plan_until = ? where email = ?').run(days ? 'pro' : 'free', days ? Date.now() + days * 86_400_000 : null, email)
      if (!res.changes) throw new HttpError(404, 'Không có tài khoản với email này')
      return { ok: true, email, plan: days ? 'pro' : 'free', until: days ? Date.now() + days * 86_400_000 : null }
    },
    'POST /api/chat': (r) => { const u = me(r); return ai.chat(d.db, u, d.ai, r.body, adv(u)) },
    'POST /api/chat/clear': (r) => {
      const u = me(r)
      d.db.prepare('delete from chats where user_id = ? and persona = ?').run(u.id, String(r.body.persona ?? ''))
      return ai.store(d.db, u.id)
    },
  }
}
