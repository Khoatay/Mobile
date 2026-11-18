/**
 * Gọi nhiều nhà cung cấp AI qua một giao diện chung: Claude, ChatGPT, Gemini và các dịch vụ "tương thích OpenAI"
 * (DeepSeek, Grok, OpenRouter, Qwen, Groq…). Không cần thêm thư viện: ngoài Claude, mọi nhà đều gọi bằng fetch.
 */
import Anthropic from '@anthropic-ai/sdk'

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'xai' | 'openrouter' | 'qwen' | 'groq' | 'custom'
export interface ProviderInfo { id: ProviderId; label: string; base?: string; keyUrl: string; hint: string; adminOnly?: boolean }

export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)', keyUrl: 'console.anthropic.com', hint: 'Khoá bắt đầu bằng sk-ant-' },
  { id: 'openai', label: 'ChatGPT (OpenAI)', base: 'https://api.openai.com/v1', keyUrl: 'platform.openai.com/api-keys', hint: 'Khoá bắt đầu bằng sk-' },
  { id: 'gemini', label: 'Gemini (Google)', keyUrl: 'aistudio.google.com/apikey', hint: 'Khoá bắt đầu bằng AIza' },
  { id: 'deepseek', label: 'DeepSeek', base: 'https://api.deepseek.com/v1', keyUrl: 'platform.deepseek.com', hint: '' },
  { id: 'xai', label: 'Grok (xAI)', base: 'https://api.x.ai/v1', keyUrl: 'console.x.ai', hint: '' },
  { id: 'openrouter', label: 'OpenRouter (hàng trăm model)', base: 'https://openrouter.ai/api/v1', keyUrl: 'openrouter.ai/keys', hint: 'Một khoá dùng được model của nhiều hãng' },
  { id: 'qwen', label: 'Qwen (Alibaba)', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyUrl: 'dashscope.console.aliyun.com', hint: '' },
  { id: 'groq', label: 'Groq', base: 'https://api.groq.com/openai/v1', keyUrl: 'console.groq.com/keys', hint: '' },
  // Địa chỉ tự nhập: chỉ chủ app dùng, để khách không bắt máy chủ gọi tới địa chỉ bất kỳ.
  { id: 'custom', label: 'Địa chỉ khác (tương thích OpenAI)', keyUrl: '', hint: 'Nhập địa chỉ API, ví dụ https://…/v1', adminOnly: true },
]
export const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id)

export interface LlmCfg { provider: ProviderId; model: string; key: string; base?: string }
export interface Turn { role: 'user' | 'assistant'; content: string }
export interface LlmResult { text: string; model: string; refused: boolean; usage: { in: number; out: number; cacheRead: number; cacheWrite: number } }

export class LlmError extends Error { constructor(public kind: 'auth' | 'quota' | 'model' | 'other', message: string) { super(message) } }

function friendly(status: number, body: string): LlmError {
  const b = body.toLowerCase()
  if (status === 401 || status === 403 || b.includes('invalid api key') || b.includes('api key not valid') || b.includes('incorrect api key')) return new LlmError('auth', 'Khoá AI không đúng hoặc đã bị thu hồi')
  if (status === 402 || b.includes('insufficient') || b.includes('quota') || b.includes('credit') || b.includes('balance')) return new LlmError('quota', 'Tài khoản AI hết tiền hoặc hết hạn mức. Nạp thêm ở trang của nhà cung cấp')
  if (status === 429) return new LlmError('quota', 'AI đang quá tải hoặc vượt giới hạn tốc độ. Thử lại sau ít phút')
  if (status === 404 || b.includes('model') && (b.includes('not found') || b.includes('does not exist'))) return new LlmError('model', 'Không có model này, hoặc khoá không được dùng model này')
  return new LlmError('other', `AI báo lỗi (${status}): ${body.slice(0, 200)}`)
}

const baseOf = (c: LlmCfg) => (c.base || providerOf(c.provider)?.base || '').replace(/\/+$/, '')

async function post(url: string, headers: Record<string, string>, body: unknown, f: typeof fetch) {
  let res: Response
  try { res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }) }
  catch (e) { throw new LlmError('other', `Không gọi được AI: ${(e as Error).message}`) }
  const text = await res.text()
  if (!res.ok) throw friendly(res.status, text)
  return JSON.parse(text)
}

export async function complete(c: LlmCfg, system: string, turns: Turn[], maxTokens = 2000, f: typeof fetch = fetch, anthropic?: Pick<Anthropic, 'messages'>): Promise<LlmResult> {
  if (!c.key && !anthropic) throw new LlmError('auth', 'Chưa có khoá AI')
  if (!c.model) throw new LlmError('model', 'Chưa chọn model')

  if (c.provider === 'anthropic') {
    const client = anthropic ?? new Anthropic({ apiKey: c.key })
    const messages: Anthropic.MessageParam[] = turns.map((t, i) => ({
      role: t.role,
      // Đánh dấu cache ở tin cuối: lượt sau chỉ trả đủ giá cho phần mới.
      content: i === turns.length - 1 ? [{ type: 'text', text: t.content, cache_control: { type: 'ephemeral' } }] : t.content,
    }))
    try {
      const r = await client.messages.create({ model: c.model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages })
      const u = r.usage as Anthropic.Usage
      return {
        text: r.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim(), model: r.model, refused: r.stop_reason === 'refusal',
        usage: { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
      }
    } catch (e) {
      if (e instanceof Anthropic.APIError) throw friendly(e.status ?? 0, e.message)
      throw e
    }
  }

  if (c.provider === 'gemini') {
    const model = c.model.replace(/^models\//, '')
    const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': c.key }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
      generationConfig: { maxOutputTokens: maxTokens },
    }, f)
    const cand = r.candidates?.[0]
    const u = r.usageMetadata ?? {}
    return {
      text: (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim(), model,
      refused: !cand || cand.finishReason === 'SAFETY' || !!r.promptFeedback?.blockReason,
      usage: { in: (u.promptTokenCount ?? 0) - (u.cachedContentTokenCount ?? 0), out: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheRead: u.cachedContentTokenCount ?? 0, cacheWrite: 0 },
    }
  }

  // OpenAI và các dịch vụ tương thích.
  const base = baseOf(c)
  if (!/^https:\/\//.test(base)) throw new LlmError('other', 'Địa chỉ API phải bắt đầu bằng https://')
  const official = c.provider === 'openai'
  const r = await post(`${base}/chat/completions`, { authorization: `Bearer ${c.key}` }, {
    model: c.model,
    messages: [{ role: official ? 'developer' : 'system', content: system }, ...turns],
    ...(official ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
  }, f)
  const ch = r.choices?.[0]
  const u = r.usage ?? {}
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0
  return {
    text: String(ch?.message?.content ?? '').trim(), model: r.model ?? c.model, refused: ch?.finish_reason === 'content_filter' || !!ch?.message?.refusal,
    usage: { in: (u.prompt_tokens ?? 0) - cached, out: u.completion_tokens ?? 0, cacheRead: cached, cacheWrite: 0 },
  }
}

/** Danh sách model khoá này dùng được, lấy thẳng từ nhà cung cấp (nên luôn mới, không phải sửa code khi hãng ra model mới). */
export async function listModels(c: Omit<LlmCfg, 'model'>, f: typeof fetch = fetch): Promise<string[]> {
  if (!c.key) throw new LlmError('auth', 'Chưa có khoá AI')
  const get = async (url: string, headers: Record<string, string>) => {
    let res: Response
    try { res = await f(url, { headers, signal: AbortSignal.timeout(20_000) }) } catch (e) { throw new LlmError('other', `Không gọi được AI: ${(e as Error).message}`) }
    const text = await res.text()
    if (!res.ok) throw friendly(res.status, text)
    return JSON.parse(text)
  }
  let ids: string[]
  if (c.provider === 'anthropic') {
    ids = ((await get('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': c.key, 'anthropic-version': '2023-06-01' })).data ?? []).map((m: { id: string }) => m.id)
  } else if (c.provider === 'gemini') {
    const r = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': c.key })
    ids = (r.models ?? []).filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent')).map((m: { name: string }) => m.name.replace(/^models\//, ''))
  } else {
    const base = baseOf({ ...c, model: '' })
    if (!/^https:\/\//.test(base)) throw new LlmError('other', 'Địa chỉ API phải bắt đầu bằng https://')
    ids = ((await get(`${base}/models`, { authorization: `Bearer ${c.key}` })).data ?? []).map((m: { id: string }) => m.id)
  }
  // Bỏ model không dùng để chat (tạo ảnh, đọc giọng nói, nhúng…).
  const skip = /embed|whisper|tts|dall-e|image|audio|realtime|moderation|transcribe|search-preview|guard|rerank/i
  return [...new Set(ids.filter((id) => !skip.test(id)))].sort()
}

/** Giá USD / 1 triệu token của các model Claude (bảng giá 11/2026). Model khác: chủ app tự nhập giá ở trang quản trị. */
export const KNOWN_PRICES: Record<string, [number, number, number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125], 'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'claude-opus-5-5': [4, 20, 0.2, 5],
}
