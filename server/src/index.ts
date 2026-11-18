/** Máy chủ Golden Duck: npm start. Cấu hình ở file .env (xem .env.example). */
import { createServer } from 'node:http'
import path from 'node:path'
import { routes, onChannelMessage, type AppDeps } from './app'
import { Bot } from './bot'
import { config, secureCookies } from './config'
import { openDb } from './db'
import { createHandler } from './http'
import { Relay } from './relay'
import { initSecrets } from './secrets'
import { TgReader } from './tg'

const db = openDb(config.dataDir)
initSecrets(config.dataDir)
const bot = new Bot(config.botToken, db)
const deps: AppDeps = {
  db, bot,
  reader: undefined as unknown as AppDeps['reader'],
  ai: { envKey: config.anthropicKey, envModel: config.chatModel, perDay: config.chatPerDay },
  adminEmails: config.adminEmails,
  channelsMax: config.channelsMax,
  secure: secureCookies(),
  relay: new Relay(),
  webDir: config.webDir,
  bridgeAiPerDay: config.bridgeAiPerDay,
}
const reader = new TgReader(config.tgApiId, config.tgApiHash, path.join(config.dataDir, 'tg.session'), (tgId, m) => {
  const row = db.prepare("select id from channels where tg_id = ? and status = 'ok'").get(tgId) as { id: number } | undefined
  if (row) onChannelMessage(deps, row.id, m)
})
deps.reader = reader

const server = createServer(createHandler(routes(deps), config.webDir))
// AI phân tích qua bridge có thể chạy vài phút: không cắt yêu cầu dài.
server.requestTimeout = 0
server.listen(config.port, '127.0.0.1', () => {
  console.log(`[golden-duck] chạy ở cổng ${config.port} (${config.publicUrl})`)
})
reader.start().catch((e) => { reader.error = (e as Error).message; console.error('[telegram]', e) })
if (!reader.ok && reader.error) console.warn('[telegram]', reader.error)
void bot.start()


// Dọn tin cũ hơn 90 ngày mỗi ngày một lần để file dữ liệu không phình mãi.
setInterval(() => db.prepare('delete from messages where date < ?').run(Math.floor(Date.now() / 1000) - 90 * 86_400), 86_400_000).unref()
