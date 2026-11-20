/** Đăng ký, đăng nhập: mật khẩu băm scrypt (muối riêng từng người), phiên là chuỗi ngẫu nhiên lưu trong cookie httpOnly. */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { DB } from './db'
import { HttpError } from './http'

const DAY = 86_400_000
export const SESSION_DAYS = 30
export interface User { id: number; email: string; name: string; plan: string; plan_until: number | null; tg_chat: number | null; tg_name: string; link_code: string; created: number
  /** Khách mở Exness dưới link IB của chủ app (kiểm tra qua Exness Partnership API): được Pro. */
  ib?: number; ib_checked?: number; ib_accounts?: string }

export function hashPassword(pass: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('base64')}$${scryptSync(pass, salt, 64).toString('base64')}`
}
export function verifyPassword(pass: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64')
  const got = scryptSync(pass, Buffer.from(salt, 'base64'), want.length)
  return got.length === want.length && timingSafeEqual(got, want)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase()

export function register(db: DB, body: { email?: unknown; password?: unknown; name?: unknown }): User {
  const email = normEmail(body.email)
  const pass = String(body.password ?? '')
  if (!EMAIL.test(email)) throw new HttpError(400, 'Email không hợp lệ')
  if (pass.length < 8) throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự')
  if (db.prepare('select 1 from users where email = ?').get(email)) throw new HttpError(409, 'Email này đã có tài khoản. Hãy đăng nhập')
  const r = db.prepare('insert into users (email, name, pass, created, link_code) values (?, ?, ?, ?, ?)')
    .run(email, String(body.name ?? '').trim().slice(0, 60), hashPassword(pass), Date.now(), randomBytes(6).toString('hex'))
  return getUser(db, Number(r.lastInsertRowid))!
}

export function login(db: DB, body: { email?: unknown; password?: unknown }): User {
  const row = db.prepare('select id, pass from users where email = ?').get(normEmail(body.email)) as { id: number; pass: string } | undefined
  // Cùng một thông báo cho email sai và mật khẩu sai, để không lộ email nào đã đăng ký.
  if (!row || !verifyPassword(String(body.password ?? ''), row.pass)) throw new HttpError(401, 'Email hoặc mật khẩu không đúng')
  return getUser(db, row.id)!
}

export function getUser(db: DB, id: number): User | null {
  return (db.prepare('select id, email, name, plan, plan_until, tg_chat, tg_name, link_code, created, ib, ib_checked, ib_accounts from users where id = ?').get(id) as unknown as User) ?? null
}

/** Gói đang có hiệu lực: Pro hết hạn thì về Free. Khách thuộc nhánh IB của chủ app luôn được Pro. */
export const planOf = (u: Pick<User, 'plan' | 'plan_until'> & { ib?: number }, now = Date.now()) => (u.ib === 1 || (u.plan === 'pro' && (!u.plan_until || u.plan_until > now)) ? 'pro' : 'free')

export function createSession(db: DB, userId: number): string {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('insert into sessions (token, user_id, created, expires) values (?, ?, ?, ?)').run(token, userId, now, now + SESSION_DAYS * DAY)
  db.prepare('delete from sessions where expires < ?').run(now)
  return token
}
export function userBySession(db: DB, token: string | undefined): User | null {
  if (!token) return null
  const row = db.prepare('select user_id from sessions where token = ? and expires > ?').get(token, Date.now()) as { user_id: number } | undefined
  return row ? getUser(db, row.user_id) : null
}
export const endSession = (db: DB, token: string | undefined) => { if (token) db.prepare('delete from sessions where token = ?').run(token) }

/** Chặn đoán mật khẩu: tối đa 10 lần sai mỗi 15 phút cho mỗi IP. */
const fails = new Map<string, number[]>()
export function checkRate(ip: string) {
  const now = Date.now()
  const list = (fails.get(ip) ?? []).filter((t) => now - t < 15 * 60_000)
  fails.set(ip, list)
  if (list.length >= 10) throw new HttpError(429, 'Thử sai quá nhiều lần. Đợi 15 phút rồi thử lại')
}
export const noteFail = (ip: string) => fails.set(ip, [...(fails.get(ip) ?? []), Date.now()])
