/** Đăng nhập tài khoản Telegram đọc kênh (chạy một lần trên máy chủ): npm run tg-login. Lưu phiên vào data/tg.session. */
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions'
import { config } from './config'

const rl = createInterface({ input: process.stdin, output: process.stdout })
if (!config.tgApiId || !config.tgApiHash) { console.error('Điền TG_API_ID và TG_API_HASH trong file .env trước (lấy ở my.telegram.org).'); process.exit(1) }
const client = new TelegramClient(new StringSession(''), config.tgApiId, config.tgApiHash, { connectionRetries: 5 })
await client.start({
  phoneNumber: () => rl.question('Số điện thoại của tài khoản đọc kênh (dạng +84…): '),
  phoneCode: () => rl.question('Mã Telegram vừa gửi: '),
  password: () => rl.question('Mật khẩu hai lớp (nếu có, không có thì Enter): '),
  onError: (e) => console.error(e.message),
})
mkdirSync(config.dataDir, { recursive: true })
const file = path.join(config.dataDir, 'tg.session')
writeFileSync(file, String(client.session.save()), { mode: 0o600 })
console.log(`Đã đăng nhập. Phiên lưu ở ${file}. Khởi động lại máy chủ: sudo systemctl restart golden-duck`)
await client.disconnect()
rl.close()
process.exit(0)
