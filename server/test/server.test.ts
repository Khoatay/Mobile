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
import { initSecrets, open as openSecret, seal } from '../src/secrets'
import { complete, listModels } from '../src/llm'
import { Relay, toOpenAi, fromOpenAi, Watchdog, ensureTable, newToken, outages } from '../src/relay'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

initSecrets('', Buffer.alloc(32, 7))

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
    ai: {
      envKey: '', envModel: 'claude-haiku-5-5', perDay: { free: 2, pro: 200 },
      anthropic: { messages: { create: async () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Chào bạn' }], usage: { input_tokens: 1000, output_tokens: 100 } }) } } as never,
      // Giả lập OpenAI cho khách dùng khoá riêng.
      fetch: (async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-x' }, { id: 'text-embedding-3' }] }))
        const body = JSON.parse(String(init?.body))
        if ((init?.headers as Record<string, string>).authorization !== 'Bearer sk-dung') return new Response('{"error":{"message":"Incorrect API key"}}', { status: 401 })
        return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: 'Trả lời từ GPT' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 5 } }))
      }) as typeof fetch,
    },
    channelsMax: { free: 2, pro: 20 }, secure: false,
    relay: new Relay(), webDir: '/nonexistent', bridgeAiPerDay: { free: 1, pro: 50 },
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
    const r1 = await call('a', 'POST', '/api/chat', { persona: duck.id, message: 'Hôm nay mình nên học gì?' })
    expect(r1.body.reply).toBe('Chào bạn')
    expect(r1.body.chats[duck.id]).toHaveLength(2)
    expect(r1.body.remaining).toBe(1)
    await call('a', 'POST', '/api/chat', { persona: duck.id, message: 'Còn gì nữa không?' })
    expect((await call('a', 'POST', '/api/chat', { persona: duck.id, message: 'nữa' })).status).toBe(429)
    const cost = db.prepare('select cost from ai_usage').get() as { cost: number }
    expect(cost.cost).toBeCloseTo(2 * (1000 * 0.1 + 100 * 0.5) / 1e6)
  })

  it('khách tự mang khoá: chọn nhà cung cấp, lấy danh sách model, chat không tính vào lượt', async () => {
    const duck = 'duck'
    expect((await call('a', 'POST', '/api/ai/me', { mode: 'own', provider: 'openai', model: 'gpt-x' })).status).toBe(400) // chưa có khoá
    const m = await call('a', 'POST', '/api/ai/models', { provider: 'openai', key: 'sk-dung' })
    expect(m.body.models).toEqual(['gpt-x'])
    const saved = await call('a', 'POST', '/api/ai/me', { mode: 'own', provider: 'openai', model: 'gpt-x', key: 'sk-dung' })
    expect(saved.body).toMatchObject({ mode: 'own', provider: 'openai', model: 'gpt-x', key: '…dung' })
    expect(JSON.stringify(saved.body)).not.toContain('sk-dung')
    const raw = db.prepare('select key_enc from user_ai').get() as { key_enc: string }
    expect(raw.key_enc).not.toContain('sk-dung')
    expect(openSecret(raw.key_enc)).toBe('sk-dung')
    // Đã hết lượt AI của hệ thống nhưng khoá riêng vẫn chat được.
    const r = await call('a', 'POST', '/api/chat', { persona: duck, message: 'Chào' })
    expect(r.body.reply).toBe('Trả lời từ GPT')
    expect(r.body.own).toBe(true)
    await call('a', 'POST', '/api/ai/me', { mode: 'own', provider: 'openai', key: 'sk-sai' })
    expect((await call('a', 'POST', '/api/chat', { persona: duck, message: 'Chào' })).body.error).toMatch(/Khoá AI không đúng/)
    expect((await call('a', 'POST', '/api/ai/me', { mode: 'own', provider: 'custom', model: 'x', key: 'k' })).status).toBe(400)
    await call('a', 'POST', '/api/ai/me', { mode: 'system' })
  })

  it('nhân vật tự tạo có kiến thức riêng', async () => {
    const r = await call('a', 'POST', '/api/personas/save', { name: 'Thầy Scalp', knowledge: 'Chỉ vào lệnh phiên Âu, SL 30 pip.' })
    expect(r.body.items.find((p: { id: string }) => p.id === r.body.saved)).toMatchObject({ name: 'Thầy Scalp', knowledge: 'Chỉ vào lệnh phiên Âu, SL 30 pip.' })
    // Người khác không thấy.
    expect((await call('b', 'GET', '/api/personas')).body.items.some((p: { name: string }) => p.name === 'Thầy Scalp')).toBe(false)
    expect((await call('b', 'POST', '/api/personas/save', { id: r.body.saved, name: 'Cướp' })).status).toBe(403) // khách Free không tạo nhân vật
    const del = await call('a', 'POST', '/api/personas/delete', { id: r.body.saved })
    expect(del.body.items.some((p: { name: string }) => p.name === 'Thầy Scalp')).toBe(false)
  })

  it('trang quản trị chỉ cho chủ app (tài khoản đầu tiên)', async () => {
    expect((await call('a', 'GET', '/api/me')).body.admin).toBe(true)
    expect((await call('b', 'GET', '/api/admin/ai')).status).toBe(403)
    const r = await call('a', 'POST', '/api/admin/ai', { slot: 'cheap', provider: 'openai', model: 'gpt-x', key: 'sk-dung', priceIn: 1, priceOut: 4 })
    expect(r.body).toMatchObject({ cheap: { provider: 'openai', model: 'gpt-x' }, ready: { cheap: true } })
    expect(r.body.keys.openai).toBe('…dung')
    const c = await call('b', 'POST', '/api/chat', { persona: 'duck', message: 'Hi' })
    expect(c.body.reply).toBe('Trả lời từ GPT')
    const cost = db.prepare('select cost from ai_usage where user_id = 2').get() as { cost: number }
    expect(cost.cost).toBeCloseTo((50 * 1 + 5 * 4) / 1e6)
    await call('a', 'POST', '/api/admin/ai', { slot: 'cheap', provider: 'anthropic', model: 'claude-haiku-5-5' })
  })

  it('khách Free: không dùng khoá riêng; câu hỏi cơ bản trả lời soạn sẵn, không tính lượt', async () => {
    expect((await call('b', 'POST', '/api/ai/me', { mode: 'own', provider: 'openai', model: 'gpt-x', key: 'sk-dung' })).status).toBe(403)
    const before = (await call('b', 'GET', '/api/me')).body.chatToday
    const r = await call('b', 'POST', '/api/chat', { persona: 'duck', message: 'Pip là gì?' })
    expect(r.body.canned).toBe(true)
    expect(r.body.reply).toMatch(/10 pip = 1 giá/)
    expect((await call('b', 'GET', '/api/me')).body.chatToday).toBe(before)
    expect((await call('a', 'GET', '/api/admin/ai')).body.today.canned).toBe(1)
  })

  it('chủ app nâng khách lên Pro: mở khoá tính năng nâng cao; Pro dùng model mạnh nếu bật', async () => {
    expect((await call('b', 'POST', '/api/admin/plan', { email: 'binh@mail.com', days: 30 })).status).toBe(403)
    expect((await call('a', 'POST', '/api/admin/plan', { email: 'khongco@mail.com', days: 30 })).status).toBe(404)
    await call('a', 'POST', '/api/admin/plan', { email: 'binh@mail.com', days: 30 })
    const b = (await call('b', 'GET', '/api/me')).body
    expect(b).toMatchObject({ plan: 'pro', advanced: true, admin: false })
    expect((await call('b', 'POST', '/api/personas/save', { name: 'Của Bình' })).status).toBe(200)
    await call('a', 'POST', '/api/admin/ai', { slot: 'strong', provider: 'openai', model: 'gpt-x', key: 'sk-dung', proStrong: true })
    expect((await call('b', 'POST', '/api/chat', { persona: 'duck', message: 'Phân tích giúp tâm lý sau chuỗi thua' })).body.reply).toBe('Trả lời từ GPT')
    await call('a', 'POST', '/api/admin/ai', { proStrong: false })
    expect((await call('b', 'POST', '/api/chat', { persona: 'duck', message: 'Phân tích tiếp' })).body.reply).toBe('Chào bạn')
    await call('a', 'POST', '/api/admin/plan', { email: 'binh@mail.com', days: 0 })
    expect((await call('b', 'GET', '/api/me')).body.advanced).toBe(false)
  })

  it('đăng xuất', async () => {
    await call('a', 'POST', '/api/auth/logout', {})
    expect((await call('a', 'GET', '/api/me')).status).toBe(401)
  })
})

describe('các nhà cung cấp AI', () => {
  it('Gemini: đổi vai, đọc kết quả', async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null
    const f = (async (url: string, init: RequestInit) => { sent = { url, body: JSON.parse(String(init.body)) }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Xin chào' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } })) }) as typeof fetch
    const r = await complete({ provider: 'gemini', model: 'gemini-x', key: 'AIza' }, 'sys', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], 100, f)
    expect(r).toMatchObject({ text: 'Xin chào', refused: false, usage: { in: 10, out: 3 } })
    expect(sent!.url).toContain('/models/gemini-x:generateContent')
    expect((sent!.body.contents as { role: string }[]).map((c) => c.role)).toEqual(['user', 'model', 'user'])
  })
  it('DeepSeek dùng địa chỉ riêng, lỗi hết tiền nói rõ', async () => {
    const f = (async (url: string) => { expect(url).toBe('https://api.deepseek.com/v1/chat/completions'); return new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 }) }) as typeof fetch
    await expect(complete({ provider: 'deepseek', model: 'deepseek-chat', key: 'k' }, 's', [{ role: 'user', content: 'x' }], 10, f)).rejects.toThrow(/hết tiền/)
  })
  it('lọc model không dùng để chat', async () => {
    const f = (async () => new Response(JSON.stringify({ models: [{ name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] }] }))) as typeof fetch
    expect(await listModels({ provider: 'gemini', key: 'k' }, f)).toEqual(['gemini-a'])
  })
  it('mã hoá khoá', () => {
    const s = seal('bi-mat')
    expect(s).not.toContain('bi-mat')
    expect(openSecret(s)).toBe('bi-mat')
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

describe('nối bridge trên máy khách', () => {
  const db = openDb('', ':memory:')
  const web = mkdtempSync(path.join(tmpdir(), 'gd-web-'))
  writeFileSync(path.join(web, 'brand.json'), JSON.stringify({ proFeatures: ['copier', 'ai'] }))
  const upstream: { headers: Record<string, string>; body: Record<string, unknown> }[] = []
  const deps: AppDeps = {
    db, reader: { ready: () => false, join: async () => { throw new Error('x') } }, bot: { username: '', configured: () => false, send: async () => false },
    ai: {
      envKey: 'sk-ant-cua-chu-app', envModel: 'claude-haiku-5-5', perDay: { free: 2, pro: 200 },
      fetch: (async (url: string, init?: RequestInit) => {
        upstream.push({ headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) })
        expect(String(url)).toBe('https://api.anthropic.com/v1/messages?beta=true')
        return new Response(JSON.stringify({ id: 'm', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 1000, output_tokens: 200 } }))
      }) as typeof fetch,
    },
    channelsMax: { free: 2, pro: 20 }, secure: false, relay: new Relay(), webDir: web, bridgeAiPerDay: { free: 1, pro: 50 }, pollMs: 300,
  }
  let server: Server
  let base = ''
  beforeAll(async () => {
    server = createServer(createHandler(routes(deps), web))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => server.close())
  let cookie = ''
  const user = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
    const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0]
    return { status: res.status, body: await res.json() }
  }
  const asBridge = async (token: string, p: string, body: unknown = {}, extra: Record<string, string> = {}) => {
    const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...extra }, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json() }
  }
  /** Bridge giả: hỏi việc một lần, làm bằng hàm cho sẵn rồi trả kết quả. */
  const serveOnce = async (token: string, work: (job: { method: string; path: string; body: unknown }) => [number, unknown]) => {
    const job = (await asBridge(token, '/api/bridge/poll')).body
    if (!job.id) return null
    const [status, body] = work(job)
    await asBridge(token, '/api/bridge/reply', { id: job.id, status, body })
    return job
  }

  it('chưa nối bridge: báo rõ; mã sai bị từ chối', async () => {
    await user('POST', '/api/auth/register', { email: 'chu@app.com', password: '12345678' })
    const r = await user('GET', '/api/relay?p=/status')
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/chưa kết nối/)
    expect((await asBridge('gdb_sai', '/api/bridge/poll')).status).toBe(401)
  })

  it('trình duyệt gọi bridge qua máy chủ, lỗi của bridge chuyển nguyên về', async () => {
    const { token } = (await user('POST', '/api/bridge/token')).body
    expect(token).toMatch(/^gdb_/)
    expect((await asBridge(token, '/api/bridge/poll')).body.id).toBe('')  // không có việc: trả rỗng sau thời gian chờ
    expect((await user('GET', '/api/bridge/status')).body).toMatchObject({ online: true, hasToken: true })
    const pending = user('GET', '/api/relay?p=' + encodeURIComponent('/accounts'))
    const job = await serveOnce(token, (j) => [200, [{ id: '1', path: j.path }]])
    expect(job).toMatchObject({ method: 'GET', path: '/accounts' })
    expect((await pending).body).toEqual([{ id: '1', path: '/accounts' }])
    const bad = user('POST', '/api/relay', { path: '/order', body: { symbol: 'XAUUSD' } })
    await serveOnce(token, (j) => { expect(j.body).toEqual({ symbol: 'XAUUSD' }); return [400, { error: 'Thiếu SL' }] })
    expect(await bad).toEqual({ status: 400, body: { error: 'Thiếu SL' } })
    // mã cũ hết hiệu lực khi tạo mã mới
    const again = (await user('POST', '/api/bridge/token')).body.token
    expect((await asBridge(token, '/api/bridge/poll')).status).toBe(401)
    expect((await asBridge(again, '/api/bridge/poll')).status).toBe(200)
  })

  it('máy chủ chặn tính năng Pro trước khi tới bridge', async () => {
    const r = await user('POST', '/api/relay', { path: '/automation/copier', body: { config: { enabled: true, master: '1', followers: [] } } })
    expect(r.status).toBe(402)
    expect(r.body.error).toMatch(/Copy lệnh là tính năng Pro/)
    expect((await user('POST', '/api/relay', { path: '/ai/key', body: { key: 'x' } })).status).toBe(403)
  })

  it('AI của bridge đi qua máy chủ bằng khoá và model của chủ app, có giới hạn lượt', async () => {
    const t = (await user('POST', '/api/bridge/token')).body.token
    const ask = (feature: string) => asBridge(t, '/api/bridge/anthropic/v1/messages?beta=true', { model: 'claude-opus-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }], fallbacks: 'default' },
      { 'x-api-key': t, authorization: '', 'x-gd-feature': feature, 'anthropic-beta': 'server-side-fallback-2026-07-01', 'anthropic-version': '2023-06-01' })
    const pro = await ask('analyze')
    expect(pro.status).toBe(403)
    expect(pro.body.error.message).toMatch(/AI phân tích là tính năng Pro/)
    const ok = await ask('learn')
    expect(ok.status).toBe(200)
    expect(upstream[0].headers['x-api-key']).toBe('sk-ant-cua-chu-app')
    expect(upstream[0].body.model).toBe('claude-sonnet-5-5')
    expect(upstream[0].headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01')
    const over = await ask('learn')
    expect(over.status).toBe(403)
    expect(over.body).toMatchObject({ type: 'error', error: { type: 'permission_error' } })
    expect(over.body.error.message).toMatch(/hết 1 lượt/)
  })
  it('chủ app chọn OpenRouter (hay hãng khác) ở ô mạnh: bridge vẫn dùng được, tự đổi định dạng', async () => {
    db.prepare("insert or replace into settings (key, value) values ('ai.system', ?)").run(JSON.stringify({ strong: { provider: 'openrouter', model: 'anthropic/claude-opus-5.5', base: '', priceIn: 4, priceOut: 20 } }))
    db.prepare("insert or replace into settings (key, value) values ('ai.key.openrouter', ?)").run(JSON.stringify(seal('sk-or-chu-app')))
    db.prepare('delete from ai_usage').run()
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
    deps.ai.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ id: 'x', model: 'anthropic/claude-opus-5.5', choices: [{ message: { content: '```json\n{"rules":"FVG"}\n```' }, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 50 } }))
    }) as typeof fetch
    const t = (await user('POST', '/api/bridge/token')).body.token
    const r = await asBridge(t, '/api/bridge/anthropic/v1/messages?beta=true', {
      model: 'claude-opus-5-5', max_tokens: 16000, system: [{ type: 'text', text: 'Bạn là trợ lý' }],
      messages: [{ role: 'user', content: [{ type: 'document', title: 'sach', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } }, { type: 'text', text: 'Học đi' }] }],
      output_config: { effort: 'high', format: { type: 'json_schema', schema: { type: 'object' } } },
    }, { 'x-api-key': t, authorization: '', 'x-gd-feature': 'learn' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"rules":"FVG"}' }], usage: { input_tokens: 500, output_tokens: 50 } })
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(calls[0].headers.authorization).toBe('Bearer sk-or-chu-app')
    expect(calls[0].body.model).toBe('anthropic/claude-opus-5.5')
    expect(calls[0].body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'ket_qua', schema: { type: 'object' } } })
    const msgs = calls[0].body.messages as { role: string; content: unknown }[]
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].content).toEqual([{ type: 'file', file: { filename: 'sach.pdf', file_data: 'data:application/pdf;base64,QUJD' } }, { type: 'text', text: 'Học đi' }])
  })
})

describe('đổi định dạng Claude ↔ OpenAI', () => {
  it('ChatGPT dùng developer và max_completion_tokens; tin chỉ có chữ gộp thành một chuỗi', () => {
    const o = toOpenAi({ system: 'S', max_tokens: 10, messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] }, 'gpt-x', true) as Record<string, unknown>
    expect(o).toMatchObject({ model: 'gpt-x', max_completion_tokens: 10, messages: [{ role: 'developer', content: 'S' }, { role: 'user', content: 'a\n\nb' }] })
  })
  it('cắt lời, từ chối', () => {
    expect(fromOpenAi({ choices: [{ message: { content: 'x' }, finish_reason: 'length' }] }, 'm', false).stop_reason).toBe('max_tokens')
    expect(fromOpenAi({ choices: [{ message: { content: '', refusal: 'no' }, finish_reason: 'stop' }] }, 'm', false).stop_reason).toBe('refusal')
  })
})

describe('canh máy MT5 mất kết nối', () => {
  it('mất quá 2 phút thì báo Telegram, có lại thì báo; chớp mạng ngắn không báo', () => {
    const db = openDb('', ':memory:')
    ensureTable(db)
    db.prepare("insert into users (id, email, pass, created, link_code, tg_chat) values (1, 'a@b.c', 'x', 0, 'c', 555)").run()
    newToken(db, 1)
    let online = true, seen = 0
    const relay = { online: () => online, lastSeen: () => seen } as unknown as Relay
    const sent: string[] = []
    const w = new Watchdog(db, relay, async (_c, t) => { sent.push(t) }, 120_000)
    w.tick(0)                                   // thấy kết nối lần đầu
    online = false; seen = 10_000; w.tick(40_000) // vừa mất
    w.tick(100_000)                             // mới 90 giây: chưa báo
    online = true; w.tick(110_000)              // có lại nhanh: không báo gì
    expect(sent).toEqual([])
    online = false; seen = 200_000; w.tick(230_000); w.tick(330_000)  // mất 130 giây
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/mất kết nối/)
    w.tick(400_000)
    expect(sent).toHaveLength(1)                // không báo lặp
    online = true; w.tick(800_000)
    expect(sent[1]).toMatch(/kết nối lại sau 10 phút/)
    expect(outages(db, 1).length).toBe(0)       // mốc thời gian giả quá cũ so với 7 ngày gần đây
    expect((db.prepare('select start, end from bridge_outages').get() as { start: number; end: number })).toEqual({ start: 200_000, end: 800_000 })
  })
})
