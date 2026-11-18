/**
 * Tài khoản Telegram đọc kênh (MTProto, thư viện teleproto). Dùng một số điện thoại riêng, đăng nhập một lần bằng npm run tg-login.
 * Đọc được mọi kênh tài khoản này tham gia, kể cả kênh của người khác (bot chỉ đọc được kênh mà nó làm quản trị).
 */
import { readFileSync, existsSync } from 'node:fs'
import { Api, TelegramClient, utils } from 'teleproto'
import { NewMessage, type NewMessageEvent } from 'teleproto/events'
import { StringSession } from 'teleproto/sessions'
import type { ChannelRef, Reader } from './channels'

type Msg = { id: number; date: number; text: string }

export class TgReader implements Reader {
  client: TelegramClient | null = null
  ok = false
  error = 'Chưa khởi động'

  constructor(private apiId: number, private apiHash: string, private sessionFile: string, private onNew: (tgId: string, m: Msg) => void) {}

  ready() { return this.ok }

  async start() {
    if (!this.apiId || !this.apiHash) { this.error = 'Chưa cấu hình TG_API_ID, TG_API_HASH'; return }
    if (!existsSync(this.sessionFile)) { this.error = 'Chưa đăng nhập tài khoản đọc kênh: chạy npm run tg-login'; return }
    const session = new StringSession(readFileSync(this.sessionFile, 'utf8').trim())
    this.client = new TelegramClient(session, this.apiId, this.apiHash, { connectionRetries: 10 })
    await this.client.connect()
    if (!(await this.client.isUserAuthorized())) { this.error = 'Phiên Telegram hết hạn: chạy lại npm run tg-login'; return }
    this.client.addEventHandler((e: NewMessageEvent) => {
      const m = e.message
      if (!m?.message || !m.peerId) return
      this.onNew(utils.getPeerId(m.peerId), { id: m.id, date: m.date, text: m.message })
    }, new NewMessage({}))
    this.ok = true
    this.error = ''
    console.log('[telegram] Tài khoản đọc kênh đã sẵn sàng')
  }

  async join(c: ChannelRef) {
    const client = this.client
    if (!client) throw new Error(this.error)
    let entity: Api.TypeChat | Api.TypeUser | undefined
    if (c.kind === 'public') {
      await client.invoke(new Api.channels.JoinChannel({ channel: c.ref }))
      entity = (await client.getEntity(c.ref)) as Api.TypeChat
    } else {
      const hash = c.ref.slice(1)
      try {
        const r = await client.invoke(new Api.messages.ImportChatInvite({ hash }))
        entity = (r as unknown as { chats?: Api.TypeChat[] }).chats?.[0]
      } catch (e) {
        // Đã là thành viên (ví dụ khách khác đã thêm bằng @tên): lấy kênh từ thông tin link mời.
        if (!String((e as Error).message).includes('USER_ALREADY_PARTICIPANT')) throw e
        const info = await client.invoke(new Api.messages.CheckChatInvite({ hash }))
        entity = 'chat' in info ? info.chat : undefined
      }
    }
    if (!entity) throw new Error('Cannot find any entity')
    const title = 'title' in entity && entity.title ? entity.title : c.ref
    const recent: Msg[] = []
    for (const m of await client.getMessages(entity, { limit: 100 })) if (m.message) recent.push({ id: m.id, date: m.date, text: m.message })
    return { tgId: utils.getPeerId(entity), title, recent }
  }
}
