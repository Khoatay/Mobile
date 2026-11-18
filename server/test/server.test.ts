// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { routes, onChannelMessage, type AppDeps } from '../src/app'
import { hashPassword, verifyPassword, planOf } from '../src/auth'
import { Bot } from '../src/bot'
import { parseChannelRef, type Reader } from '../src/channels'
import { openDb } from '../src/db'
import { createHandler } from '../src/http'

describe('mật khẩu', () => {
  it('băm và kiểm tra', () => {
    const h = hashPassword('matkhau123')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('matkhau123', h)).toBe(true)
    expect(verifyPassword('sai', h)).toBe(false)
  })
  it('Pro hết hạn thì về Free', () => {
    expect(planOf({ plan: 'pro', plan_until: Date.now() - 1 })).toBe('free')
    expect(planOf({ plan: 'pro', plan_until: null })).toBe('pro')
  })
})

describe('đọc link kênh', () => {
  it.each([
    ['@VangSignal', 'public', 'vangsignal'], ['vangsignal', 'public', 'vangsignal'], ['https://t.me/vangsignal', 'public', 'vangsignal'],
    ['t.me/s/vangsignal/123', 'public', 'vangsignal'], ['https://t.me/+AbCdEf123456', 'invite', '+AbCdEf123456'], ['https://t.me/joinchat/AbCdEf123456', 'invite', '+AbCdEf123456'],
  ])('%s', (input, kind, ref) => expect(parseChannelRef(input)).toEqual({ kind, ref }))
  it('từ chối link t.me/c và chữ lạ', () => {
    expect(() => parseChannelRef('https://t.me/c/123456/7')).toThrow(/link mời/)
    expect(() => parseChannelRef('xin chào')).toThrow()
  })
})

describe('API', () => {
  const db = openDb('', ':memory:')
  const sent: [number, string][] = []
  const joins: string[] = []
  const now = Math.floor(Date.now() / 1000)
  const reader: Reader = {
    ready: () => true,
    join: async (c) => {
      joins.push(c.ref)
      if (c.ref === 'khongco') throw new Error('USERNAME_NOT_OCCUPIED')
      // link mời +Abc… trỏ tới cùng kênh vangsignal
      const tgId = c.ref.startsWith('+') ? '-1001' : c.ref === 'vangsignal' ? '-1001' : `-100${c.ref.length}`
      return { tgId, title: tgId === '-1001' ? 'Vàng Signal' : c.ref, recent: [{ id: 1, date: now - 3600, text: 'XAUUSD BUY 2400\nSL 2390\nTP 2420' }] }
    },
  }
  const bot = { username: 'goldenduck_bot', configured: () => true, send: async (chat: number, text: string) => { sent.push([chat, text]); return true } }
  const deps: AppDeps = {
    db, reader, bot,
    ai: { key: '', model: 'claude-haiku-5-5', perDay: { free: 2, pro: 200 }, client: { messages: { create: async () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Chào bạn' }], usage: { input_tokens: 1000, output_tokens: 100 } }) } } as never },
    channelsMax: { free: 2, pro: 20 }, secure: false,
  }
  let server: Server
  let base = ''
  beforeAll(async () => {
    server = createServer(createHandler(routes(deps), '/nonexistent'))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => server.close())

  const jar: Record<string, string> = {}
  async function call(who: string, method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: jar[who] ?? '' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const c = res.headers.get('set-cookie')
    if (c) jar[who] = c.split(';')[0]
    return { status: res.status, body: await res.json() }
  }

  it('đăng ký, đăng nhập, phiên', async () => {
    expect((await call('a', 'GET', '/api/me')).status).toBe(401)
    expect((await call('a', 'POST', '/api/auth/register', { email: 'x', password: '12345678' })).status).toBe(400)
    const r = await call('a', 'POST', '/api/auth/register', { email: 'An@Mail.com', password: '12345678', name: 'An' })
    expect(r.status).toBe(200)
    expect(r.body.email).toBe('an@mail.com')
    expect(r.body.telegram.link).toMatch(/^https:\/\/t\.me\/goldenduck_bot\?start=[0-9a-f]{12}$/)
    expect((await call('a', 'GET', '/api/me')).body.plan).toBe('free')
    expect((await call('b', 'POST', '/api/auth/register', { email: 'an@mail.com', password: '12345678' })).status).toBe(409)
    expect((await call('b', 'POST', '/api/auth/login', { email: 'an@mail.com', password: 'sai' })).status).toBe(401)
    await call('b', 'POST', '/api/auth/register', { email: 'binh@mail.com', password: '12345678' })
  })

  it('chặn ghi không phải JSON', async () => {
    const res = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' })
    expect(res.status).toBe(415)
  })

  it('khách tự thêm kênh, nhiều khách chung một kênh chỉ tham gia một lần', async () => {
    const r = await call('a', 'POST', '/api/channels/add', { ref: 'https://t.me/vangsignal' })
    expect(r.status).toBe(200)
    expect(r.body[0]).toMatchObject({ title: 'Vàng Signal', status: 'ok', messages: 1, notify: 1 })
    expect((await call('a', 'POST', '/api/channels/add', { ref: '@vangsignal' })).status).toBe(409)
    // Khách B thêm cùng kênh bằng link mời: gộp vào kênh đã có.
    const b = await call('b', 'POST', '/api/channels/add', { ref: 't.me/+AbCdEf123456' })
    expect(b.body).toHaveLength(1)
    expect(b.body[0].id).toBe(r.body[0].id)
    // Thêm lại bằng @tên: máy chủ đã đọc kênh này, không tham gia lại.
    joins.length = 0
    await call('b', 'POST', '/api/channels/remove', { id: b.body[0].id })
    await call('b', 'POST', '/api/channels/add', { ref: '@vangsignal' })
    expect(joins).toEqual([])
    expect((await call('a', 'POST', '/api/channels/add', { ref: '@khongco' })).body.error).toMatch(/Không tìm thấy/)
  })

  it('giới hạn số kênh theo gói', async () => {
    await call('a', 'POST', '/api/channels/add', { ref: '@kenhhai' })
    const r = await call('a', 'POST', '/api/channels/add', { ref: '@kenhba' })
    expect(r.status).toBe(403)
  })

  it('tin mới: lưu, báo khách đã nối bot và bật thông báo', async () => {
    const a = (await call('a', 'GET', '/api/me')).body
    db.prepare('update users set tg_chat = 111 where id = ?').run(a.id)
    const ch = (await call('a', 'GET', '/api/channels')).body[0]
    onChannelMessage(deps, ch.id, { id: 2, date: now, text: 'XAUUSD SELL 2410 SL 2420 TP 2400' })
    onChannelMessage(deps, ch.id, { id: 2, date: now, text: 'XAUUSD SELL 2410 SL 2420 TP 2400' }) // trùng: bỏ qua
    onChannelMessage(deps, ch.id, { id: 3, date: now, text: 'Chào buổi sáng cả nhà' }) // không phải lệnh
    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toBe(111)
    expect(sent[0][1]).toContain('BÁN XAUUSD')
    await call('a', 'POST', '/api/channels/notify', { id: ch.id, on: false })
    onChannelMessage(deps, ch.id, { id: 4, date: now, text: 'XAUUSD BUY 2400 SL 2390 TP 2420' })
    expect(sent).toHaveLength(1)
    const feed = (await call('a', 'GET', `/api/messages?after=${now - 7200}`)).body
    const vang = feed.filter((m: { channel: string }) => m.channel === 'Vàng Signal')
    expect(vang.map((m: { id: number }) => m.id)).toEqual([1, 2, 3, 4])
    expect(feed.filter((m: { channel: string }) => m.channel === 'kenhhai')).toHaveLength(1)
    // Khách B chưa thêm kenhhai: không thấy tin của kênh đó.
    expect((await call('b', 'GET', `/api/messages?after=${now - 7200}`)).body.every((m: { channel: string }) => m.channel === 'Vàng Signal')).toBe(true)
  })

  it('chat AI qua máy chủ có giới hạn lượt', async () => {
    const p = (await call('a', 'GET', '/api/personas')).body.items
    const duck = p.find((x: { name: string }) => x.name === 'Golden Duck')
    expect(duck).toBeTruthy()
    const r1 = await call('a', 'POST', '/api/chat', { persona: duck.id, message: 'Pip là gì?' })
    expect(r1.body.reply).toBe('Chào bạn')
    expect(r1.body.chats[duck.id]).toHaveLength(2)
    expect(r1.body.remaining).toBe(1)
    await call('a', 'POST', '/api/chat', { persona: duck.id, message: 'Lot là gì?' })
    expect((await call('a', 'POST', '/api/chat', { persona: duck.id, message: 'nữa' })).status).toBe(429)
    const cost = db.prepare('select cost from ai_usage').get() as { cost: number }
    expect(cost.cost).toBeCloseTo(2 * (1000 * 0.1 + 100 * 0.5) / 1e6)
  })

  it('đăng xuất', async () => {
    await call('a', 'POST', '/api/auth/logout', {})
    expect((await call('a', 'GET', '/api/me')).status).toBe(401)
  })
})

describe('bot nối tài khoản', () => {
  it('/start <mã> nối đúng người', async () => {
    const db = openDb('', ':memory:')
    db.prepare("insert into users (email, pass, created, link_code) values ('c@mail.com', 'x', 0, 'abc123')").run()
    const out: string[] = []
    const bot = new Bot('t', db, (async (_u: string, init: RequestInit) => { out.push(JSON.parse(String(init.body)).text); return new Response('{"ok":true,"result":{}}') }) as typeof fetch)
    await bot.handle({ chat: { id: 55, first_name: 'Chi' }, text: '/start sai' })
    await bot.handle({ chat: { id: 55, first_name: 'Chi' }, text: '/start abc123' })
    expect(out[0]).toMatch(/không đúng/)
    expect(out[1]).toMatch(/Đã nối/)
    expect(db.prepare('select tg_chat, tg_name from users').get()).toEqual({ tg_chat: 55, tg_name: 'Chi' })
  })
})
