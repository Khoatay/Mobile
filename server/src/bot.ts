/**
 * Bot Telegram chung của Golden Duck. Khách bấm "Nối Telegram" trong app → mở t.me/<bot>?start=<mã riêng> → bấm Start là xong.
 * Có máy chủ nên một bot dùng chung được (chỉ một nơi nghe tin của bot).
 */
import type { DB } from './db'

const STOP = new Set(['tắt', 'tat', '/tat', '/stop', 'stop', 'off', 'dừng', 'dung'])

export class Bot {
  username = ''
  error = ''
  private offset = 0
  private running = false
  constructor(private token: string, private db: DB, private fetchImpl: typeof fetch = fetch) {}

  configured() { return !!this.token }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs),
    })
    const out = (await res.json()) as { ok: boolean; result: T; description?: string }
    if (!out.ok) throw new Error(out.description ?? 'Telegram từ chối')
    return out.result
  }

  async send(chatId: number, text: string) {
    try { await this.call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }); return true }
    catch (e) { this.error = (e as Error).message; return false }
  }

  /** Xử lý một tin nhắn gửi tới bot. Tách riêng để kiểm thử. */
  async handle(msg: { chat?: { id?: number; first_name?: string; last_name?: string; username?: string }; text?: string }) {
    const chatId = msg.chat?.id
    const text = (msg.text ?? '').trim()
    if (!chatId) return
    if (text.startsWith('/start')) {
      const code = text.slice(6).trim()
      const user = code ? (this.db.prepare('select id, email from users where link_code = ?').get(code) as { id: number; email: string } | undefined) : undefined
      if (!user) { await this.send(chatId, 'Mã kết nối không đúng. Mở app Golden Duck → Hồ sơ → Nối Telegram rồi bấm lại nút ở đó.'); return }
      const name = [msg.chat?.first_name, msg.chat?.last_name].filter(Boolean).join(' ') || msg.chat?.username || ''
      // Một chat chỉ nối một tài khoản: gỡ khỏi tài khoản cũ nếu có.
      this.db.prepare('update users set tg_chat = null, tg_name = \'\' where tg_chat = ?').run(chatId)
      this.db.prepare('update users set tg_chat = ?, tg_name = ? where id = ?').run(chatId, name, user.id)
      await this.send(chatId, `✅ Đã nối với tài khoản ${user.email}. Lệnh mới từ các kênh bạn theo dõi và cảnh báo sẽ gửi vào đây.`)
      return
    }
    if (STOP.has(text.toLowerCase())) await this.send(chatId, 'Đã ghi nhận. Tắt thông báo từng kênh trong app: Tín hiệu → kênh → tắt chuông.')
  }

  async start() {
    if (!this.token || this.running) return
    try { this.username = (await this.call<{ username: string }>('getMe')).username } catch (e) { this.error = (e as Error).message; console.error('[bot]', this.error); return }
    this.running = true
    console.log(`[bot] @${this.username} đang nghe`)
    while (this.running) {
      try {
        const updates = await this.call<{ update_id: number; message?: Parameters<Bot['handle']>[0] }[]>('getUpdates', { offset: this.offset, timeout: 25 }, 35_000)
        this.error = ''
        for (const u of updates) { this.offset = u.update_id + 1; if (u.message) await this.handle(u.message) }
      } catch (e) {
        this.error = (e as Error).message
        await new Promise((r) => setTimeout(r, 10_000))
      }
    }
  }
  stop() { this.running = false }
}
