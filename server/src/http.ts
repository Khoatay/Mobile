/** Bộ định tuyến nhỏ trên node:http: JSON vào/ra, cookie, phục vụ file tĩnh của web app. Không cần framework. */
import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export interface Req {
  method: string
  path: string
  query: URLSearchParams
  body: Record<string, unknown>
  cookies: Record<string, string>
  ip: string
  setCookie: (name: string, value: string, opts: { maxAge: number; secure: boolean }) => void
}
export type Handler = (req: Req) => unknown | Promise<unknown>

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 1_000_000) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn')
    chunks.push(c as Buffer)
  }
  if (!chunks.length) return {}
  try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); return v && typeof v === 'object' ? v : {} }
  catch { throw new HttpError(400, 'Dữ liệu không phải JSON') }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

/** Phục vụ bản build web app; đường dẫn không có file thì trả index.html (ứng dụng một trang). */
function serveStatic(webDir: string, urlPath: string, res: ServerResponse) {
  const safe = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  let file = path.join(webDir, safe)
  if (!file.startsWith(webDir) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(webDir, 'index.html')
  if (!existsSync(file)) { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Chưa có bản build web app. Chạy npm run build:server ở thư mục gốc.'); return }
  const ext = path.extname(file)
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    // File trong assets/ có mã băm trong tên nên cache lâu được; index.html luôn lấy bản mới.
    'cache-control': safe.startsWith('/assets/') || safe.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  createReadStream(file).pipe(res)
}

export function createHandler(routes: Record<string, Handler>, webDir: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://local')
    const method = req.method ?? 'GET'
    if (!url.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405).end(); return }
      return serveStatic(webDir, url.pathname, res)
    }
    const cookies: string[] = []
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(cookies.length ? { 'set-cookie': cookies } : {}) })
      res.end(JSON.stringify(body))
    }
    const handler = routes[`${method} ${url.pathname}`]
    if (!handler) return send(404, { error: 'Không có đường dẫn này' })
    try {
      // Chống CSRF: yêu cầu ghi phải là JSON (form của trang khác không gửi được kiểu này) và cookie đặt SameSite=Lax.
      if (method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Cần gửi JSON')
      const body = method === 'GET' ? {} : await readBody(req)
      const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || ''
      const out = await handler({
        method, path: url.pathname, query: url.searchParams, body, cookies: parseCookies(req.headers.cookie), ip,
        setCookie: (name, value, o) => cookies.push(`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${o.maxAge}${o.secure ? '; Secure' : ''}`),
      })
      send(200, out ?? { ok: true })
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message })
      console.error(`[api] ${method} ${url.pathname}:`, e)
      send(500, { error: 'Lỗi máy chủ. Thử lại sau' })
    }
  }
}
