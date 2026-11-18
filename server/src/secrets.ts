/** Mã hoá khoá AI khi lưu (AES-256-GCM). Khoá mã hoá nằm trong data/secret.key, tự tạo lần đầu, không đưa lên git. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let master: Buffer | null = null
export function initSecrets(dataDir: string, fixed?: Buffer) {
  if (fixed) { master = fixed; return }
  const file = path.join(dataDir, 'secret.key')
  if (!existsSync(file)) { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 }) }
  master = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
}
const key = () => { if (!master) throw new Error('secrets chưa khởi tạo'); return master }

export function seal(plain: string): string {
  if (!plain) return ''
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`
}
export function open(sealed: string): string {
  if (!sealed) return ''
  const [v, iv, tag, data] = sealed.split(':')
  if (v !== 'v1') return ''
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')
}
/** Hiện vài ký tự cuối để người dùng nhận ra khoá nào đang dùng. */
export const maskKey = (k: string) => (k ? `…${k.slice(-4)}` : '')
