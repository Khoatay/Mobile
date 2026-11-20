/**
 * Exness Partnership API (https://www.exness-api.com): kiểm tra khách có thuộc nhánh IB của chủ app không,
 * báo cáo hoa hồng, hoàn phí. Ký mọi yêu cầu bằng khoá Ed25519 theo tài liệu "Request signing".
 *
 * Khoá nằm trong .env trên máy chủ (EXN_API_BASE_URL, EXN_API_KEY, EXN_PRIVATE_KEY), không bao giờ gửi về trình duyệt.
 * Khoá nên chỉ có quyền Partnership "Read-only" và chỉ cho phép IP của VPS.
 */
import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto'
import { HttpError } from './http'

/** Khoá bí mật: 128 ký tự hex (Exness tạo: 32 byte seed + 32 byte public key), 64 ký tự hex (chỉ seed) hoặc PEM PKCS#8. */
export function parsePrivateKey(raw: string): KeyObject {
  const s = raw.trim()
  if (s.startsWith('-----BEGIN')) return createPrivateKey(s.replace(/\\n/g, '\n'))
  const hex = s.replace(/^0x/i, '')
  if (!/^[0-9a-f]{64}([0-9a-f]{64})?$/i.test(hex)) throw new Error('EXN_PRIVATE_KEY phải là 128 ký tự hex (Exness tạo) hoặc khoá PEM')
  // Bọc 32 byte seed thành PKCS#8 DER của Ed25519 để Node đọc được.
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(hex.slice(0, 64), 'hex')])
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
}

/** Tiêu đề ký cho một yêu cầu. path gồm cả query, đúng như gửi đi. */
export function signedHeaders(apiKey: string, key: KeyObject, method: string, path: string, body: Buffer = Buffer.alloc(0), now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    api_key: apiKey, idempotency_key: '', timestamp: now, sign_version: 1,
    method: method.toUpperCase(), path, body_hash: createHash('sha256').update(body).digest('base64url'),
  }))
  return {
    'EXN-API-KEY': apiKey, 'EXN-TIMESTAMP': String(now), 'EXN-SIGN-VERSION': '1',
    'EXN-DATA': payload.toString('base64url'), 'EXN-SIGN': sign(null, payload, key).toString('base64url'),
  }
}

export interface ExnessCfg { baseUrl: string; apiKey: string; privateKey: string }
export interface Affiliation { affiliation: boolean; accounts: string[]; client_uid: string | null }

export class ExnessPartner {
  private key: KeyObject | null = null
  readonly error: string = ''
  private cache = new Map<string, { at: number; value: unknown }>()
  constructor(private cfg: ExnessCfg, private f: typeof fetch = fetch) {
    if (!this.configured) return
    try {
      this.key = parsePrivateKey(cfg.privateKey)
      if (!/^https:\/\/[^/]+$/.test(cfg.baseUrl.replace(/\/+$/, ''))) throw new Error('EXN_API_BASE_URL phải là https://<host> lấy ở ô DNS trong Key Management, không có đường dẫn')
    } catch (e) { this.key = null; (this as { error: string }).error = (e as Error).message }
  }
  get configured() { return !!(this.cfg.baseUrl && this.cfg.apiKey && this.cfg.privateKey) }
  get ready() { return !!this.key }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.key) throw new HttpError(503, this.error || 'Chưa cài khoá Exness API trên máy chủ')
    const raw = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body))
    let res: Response
    try {
      res = await this.f(this.cfg.baseUrl.replace(/\/+$/, '') + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { ...signedHeaders(this.cfg.apiKey, this.key, method, path, raw), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: raw }),
      })
    } catch (e) { throw new HttpError(502, `Không gọi được Exness: ${(e as Error).message}`) }
    const text = await res.text()
    let j: Record<string, unknown> = {}
    try { j = text ? JSON.parse(text) : {} } catch { /* trang HTML của tường lửa */ }
    if (!res.ok) {
      const code = String(j.code ?? j.error_message ?? res.status)
      const msg = String(j.message ?? j.description ?? '')
      console.error('[exness]', method, path, res.status, code, msg)
      if (res.status === 401) throw new HttpError(502, 'Exness từ chối khoá API (sai khoá, hết hạn, hoặc gọi từ IP không được phép)')
      if (res.status === 403) throw new HttpError(502, 'Khoá Exness API không có quyền cho việc này (cần quyền Partnership)')
      if (res.status === 429) throw new HttpError(429, 'Exness đang giới hạn số lần gọi. Thử lại sau ít phút')
      throw new HttpError(502, `Exness báo lỗi ${res.status}${msg ? `: ${msg.slice(0, 200)}` : ''}`)
    }
    return j as T
  }

  /** Lấy và giữ kết quả một lúc, để nhiều khách mở trang cùng lúc không làm vượt giới hạn của Exness. */
  private async cached<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
    const c = this.cache.get(key)
    if (c && Date.now() - c.at < ms) return c.value as T
    const value = await load()
    this.cache.set(key, { at: Date.now(), value })
    return value
  }

  affiliation(email: string) { return this.call<Affiliation>('POST', '/v1/partnership/affiliation', { email }) }
  summary() { return this.cached('summary', 5 * 60_000, () => this.call<Record<string, unknown>>('GET', '/v1/partnership/partner/summary')) }
  defaultLink() { return this.cached('link', 60 * 60_000, () => this.call<{ full_default_link: string; url: string; code: string }>('GET', '/v1/partnership/partner/default-link')) }
  rewardsByDay(from: string, to: string) {
    return this.cached(`rw:${from}:${to}`, 10 * 60_000, () => this.call<{ data: { reward_date: string; reward_usd: string; volume_lots: number; orders_count: number }[]; totals: { reward_usd: string; volume_lots: number; orders_count: number } }>(
      'GET', `/v1/partnership/reports/rewards?aggregate_by=day&reward_date_from=${from}&reward_date_to=${to}&limit=100`))
  }
  rebatePayments() {
    return this.cached('pay', 10 * 60_000, () => this.call<{ data: { id: number; status: string; client_account: string; rebate_usd: number; reward_usd: number; volume_lots: number; processed_date: string | null }[]; totals: { processed_rebate_usd: number; rejected_rebate_usd: number; error_rebate_usd: number } }>(
      'GET', '/v1/partnership/autorebates/payments?limit=100'))
  }
  rebateGroups() {
    return this.cached('groups', 10 * 60_000, () => this.call<{ data: { id: number; group_title: string; group_type: string; clients_count: number | null; rebate_percent: number | null; link_code: string | null; is_default: boolean }[] }>(
      'GET', '/v1/partnership/autorebates/groups?limit=100'))
  }
}
