/** Cấu hình máy chủ, đọc từ biến môi trường (file .env do systemd nạp). Không có giá trị bí mật nào trong code. */
import path from 'node:path'

const env = (k: string, d = '') => process.env[k]?.trim() || d
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d }

export const config = {
  port: num('PORT', 8080),
  /** Địa chỉ công khai, ví dụ https://goldenduck.vn. Dùng cho link nối bot và cookie Secure. */
  publicUrl: env('PUBLIC_URL', 'http://localhost:8080'),
  dataDir: path.resolve(env('DATA_DIR', 'data')),
  /** Thư mục bản build web app (npm run build:server ở thư mục gốc). */
  webDir: path.resolve(env('WEB_DIR', '../dist-server')),
  anthropicKey: env('ANTHROPIC_API_KEY'),
  /** Email chủ app (cách nhau dấu phẩy). Tài khoản đăng ký đầu tiên luôn là chủ app. */
  adminEmails: env('ADMIN_EMAILS').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean),
  chatModel: env('CHAT_MODEL', 'claude-haiku-5-5'),
  botToken: env('TELEGRAM_BOT_TOKEN'),
  tgApiId: num('TG_API_ID', 0),
  tgApiHash: env('TG_API_HASH'),
  /** Số tin chat AI mỗi ngày theo gói. */
  chatPerDay: { free: num('FREE_CHAT_PER_DAY', 15), pro: num('PRO_CHAT_PER_DAY', 200) } as Record<string, number>,
  /** Số lượt AI học trade và AI phân tích (qua bridge) mỗi ngày theo gói. */
  bridgeAiPerDay: { free: num('FREE_BRIDGE_AI_PER_DAY', 3), pro: num('PRO_BRIDGE_AI_PER_DAY', 50) } as Record<string, number>,
  /** Số kênh mỗi khách được thêm theo gói. */
  channelsMax: { free: num('FREE_CHANNELS', 3), pro: num('PRO_CHANNELS', 20) } as Record<string, number>,
}
export const secureCookies = () => config.publicUrl.startsWith('https://')
