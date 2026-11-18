/**
 * Kênh Telegram do khách tự thêm. Nhiều khách thêm cùng một kênh thì máy chủ chỉ tham gia và đọc một lần.
 * Tin mới được lưu, đọc thành lệnh bằng chính hàm của app (src/lib/signals.ts), rồi báo cho khách bật thông báo kênh đó.
 */
import { parseSignal, type Signal } from '../../src/lib/signals'
import type { DB } from './db'
import { HttpError } from './http'

export interface ChannelRef { kind: 'public' | 'invite'; ref: string }

/**
 * Đọc thứ khách dán vào: @ten, ten, t.me/ten, https://t.me/s/ten, link mời t.me/+mã hoặc t.me/joinchat/mã.
 * Link tới một tin trong kênh riêng (t.me/c/…) không dùng được vì không có cách tham gia từ đó.
 */
export function parseChannelRef(input: string): ChannelRef {
  const s = input.trim()
  const invite = s.match(/(?:t(?:elegram)?\.me\/(?:\+|joinchat\/))([\w-]{8,})/i)
  if (invite) return { kind: 'invite', ref: `+${invite[1]}` }
  if (/t(?:elegram)?\.me\/c\//i.test(s)) throw new HttpError(400, 'Đây là link tới một tin trong kênh riêng. Hãy dán link mời (t.me/+…) hoặc @tên của kênh')
  const pub = s.match(/^(?:https?:\/\/)?(?:t(?:elegram)?\.me\/)(?:s\/)?@?([a-z][\w]{3,31})(?:[/?#].*)?$/i) ?? s.match(/^@?([a-z][\w]{3,31})$/i)
  if (pub) return { kind: 'public', ref: pub[1].toLowerCase() }
  throw new HttpError(400, 'Không nhận ra kênh. Dán @tên kênh, link t.me/tên, hoặc link mời t.me/+…')
}

/** Phần nói chuyện với Telegram (tài khoản đọc kênh). Tách riêng để thử được mà không cần Telegram thật. */
export interface Reader {
  ready(): boolean
  /** Tham gia (nếu cần) và trả về id, tên kênh cùng các tin gần nhất. */
  join(c: ChannelRef): Promise<{ tgId: string; title: string; recent: { id: number; date: number; text: string }[] }>
}

export interface ChannelRow { id: number; ref: string; kind: string; title: string; tg_id: string | null; status: string; error: string; added: number; last_at: number | null }

export function listMine(db: DB, userId: number) {
  return db.prepare(`select c.id, c.ref, c.kind, c.title, c.status, c.error, c.last_at, uc.notify,
      (select count(*) from messages m where m.channel_id = c.id) as messages
    from user_channels uc join channels c on c.id = uc.channel_id where uc.user_id = ? order by uc.added`).all(userId)
}

/** Khách thêm kênh. Kênh mới với máy chủ thì tham gia ngay; kênh đã có thì chỉ gắn thêm khách. */
export async function addChannel(db: DB, reader: Reader, userId: number, input: string, max: number, onMessage: (channelId: number, m: { id: number; date: number; text: string }, quiet: boolean) => void) {
  const c = parseChannelRef(input)
  const mine = db.prepare('select count(*) as n from user_channels where user_id = ?').get(userId) as { n: number }
  let row = db.prepare('select * from channels where ref = ?').get(c.ref) as unknown as ChannelRow | undefined
  if (row && db.prepare('select 1 from user_channels where user_id = ? and channel_id = ?').get(userId, row.id)) throw new HttpError(409, 'Bạn đã thêm kênh này rồi')
  if (mine.n >= max) throw new HttpError(403, `Gói của bạn theo dõi được tối đa ${max} kênh. Xoá bớt kênh hoặc nâng cấp gói`)
  if (!row || row.status !== 'ok') {
    if (!reader.ready()) throw new HttpError(503, 'Máy chủ chưa nối được Telegram. Thử lại sau ít phút')
    let joined
    try { joined = await reader.join(c) } catch (e) { throw new HttpError(400, joinError(e)) }
    // Cùng một kênh có thể được thêm bằng @tên và bằng link mời: gộp theo id Telegram.
    const same = db.prepare('select * from channels where tg_id = ?').get(joined.tgId) as unknown as ChannelRow | undefined
    if (same) row = same
    else if (row) db.prepare("update channels set tg_id = ?, title = ?, status = 'ok', error = '' where id = ?").run(joined.tgId, joined.title, row.id)
    else {
      const r = db.prepare("insert into channels (ref, kind, title, tg_id, status, added) values (?, ?, ?, ?, 'ok', ?)").run(c.ref, c.kind, joined.title, joined.tgId, Date.now())
      row = { id: Number(r.lastInsertRowid) } as ChannelRow
    }
    row = db.prepare('select * from channels where id = ?').get(row!.id) as unknown as ChannelRow
    for (const m of joined.recent) onMessage(row.id, m, true)
    if (db.prepare('select 1 from user_channels where user_id = ? and channel_id = ?').get(userId, row.id)) throw new HttpError(409, 'Bạn đã thêm kênh này rồi')
  }
  db.prepare('insert into user_channels (user_id, channel_id, added) values (?, ?, ?)').run(userId, row.id, Date.now())
  return listMine(db, userId)
}

function joinError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/INVITE_HASH_EXPIRED|INVITE_HASH_INVALID/.test(m)) return 'Link mời đã hết hạn hoặc không đúng. Xin chủ kênh link mới'
  if (/INVITE_REQUEST_SENT/.test(m)) return 'Kênh này phải được chủ kênh duyệt. Đã gửi yêu cầu tham gia; thêm lại sau khi được duyệt'
  if (/USERNAME_INVALID|USERNAME_NOT_OCCUPIED|No user has|Cannot find any entity/i.test(m)) return 'Không tìm thấy kênh với tên này'
  if (/CHANNELS_TOO_MUCH/.test(m)) return 'Tài khoản đọc kênh của máy chủ đã đầy kênh. Báo quản trị viên'
  if (/FLOOD_WAIT/.test(m)) return 'Telegram đang giới hạn việc tham gia kênh. Thử lại sau ít phút'
  return `Không tham gia được kênh: ${m}`
}

export function removeChannel(db: DB, userId: number, channelId: number) {
  db.prepare('delete from user_channels where user_id = ? and channel_id = ?').run(userId, channelId)
  return listMine(db, userId)
}
export function setNotify(db: DB, userId: number, channelId: number, on: boolean) {
  db.prepare('update user_channels set notify = ? where user_id = ? and channel_id = ?').run(on ? 1 : 0, userId, channelId)
  return listMine(db, userId)
}

/** Lưu một tin; trả về lệnh đọc được (nếu có) khi tin là mới. */
export function storeMessage(db: DB, channelId: number, m: { id: number; date: number; text: string }): Signal | null {
  if (!m.text?.trim()) return null
  const r = db.prepare('insert or ignore into messages (channel_id, msg_id, date, text) values (?, ?, ?, ?)').run(channelId, m.id, m.date, m.text)
  if (!r.changes) return null
  db.prepare('update channels set last_at = max(coalesce(last_at, 0), ?) where id = ?').run(m.date * 1000, channelId)
  const ch = db.prepare('select title from channels where id = ?').get(channelId) as { title: string }
  return parseSignal({ channel: ch.title, id: m.id, date: m.date, text: m.text })
}

/** Tin của các kênh khách đang theo dõi (giống /telegram/messages của bridge), mới hơn `after` (giây). */
export function feed(db: DB, userId: number, after: number, limit = 500) {
  return db.prepare(`select c.title as channel, m.msg_id as id, m.date, m.text from messages m
      join user_channels uc on uc.channel_id = m.channel_id and uc.user_id = ? join channels c on c.id = m.channel_id
    where m.date > ? order by m.date desc, m.msg_id desc limit ?`).all(userId, after, limit).reverse()
}

/** Khách cần báo khi kênh có lệnh mới: đang theo dõi, bật thông báo và đã nối bot. */
export function subscribersToNotify(db: DB, channelId: number) {
  return db.prepare('select u.id, u.tg_chat from user_channels uc join users u on u.id = uc.user_id where uc.channel_id = ? and uc.notify = 1 and u.tg_chat is not null').all(channelId) as { id: number; tg_chat: number }[]
}

/** Thẻ lệnh gửi qua Telegram, viết cho người mới đọc. */
export function signalText(s: Signal): string {
  const side = s.side === 'buy' ? '🟢 MUA' : '🔴 BÁN'
  const lines = [`${side} ${s.symbol}${s.entry != null ? ` · vào ${s.entry}` : ''}`]
  lines.push(s.sl != null ? `Cắt lỗ: ${s.sl}` : '⚠ Tin không có cắt lỗ: đừng vào khi chưa tự đặt cắt lỗ')
  if (s.tps?.length) lines.push(`Chốt lời: ${s.tps.join(' · ')}`)
  lines.push(`Kênh: ${s.channel}`)
  return lines.join('\n')
}
