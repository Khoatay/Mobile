import { useEffect, useRef, useState } from 'react'
import Avatar from '../components/Avatar'
import type { InfoMap } from '../lib/accounts'
import { bridgeGet, bridgePost, type BridgeState } from '../lib/bridge'
import { accountContext, DUCK_AVATAR, DUCK_NAME, DUCK_PERSONA, isDuck, type PersonaStore } from '../lib/persona'
import { usePersistent } from '../lib/store'
import type { Trade } from '../lib/types'

interface Props { bridge: BridgeState; trades: Trade[]; infos: InfoMap; goFull: (tab?: string) => void }

/** Câu hỏi gợi ý: người mới thường không biết bắt đầu hỏi gì. */
const SUGGESTIONS = [
  'Pip và lot là gì?',
  'Vốn 100 đô thì nên vào bao nhiêu lot?',
  'Stop loss nên đặt thế nào?',
  'Mình trade dạo này thế nào?',
  'Thua 2 lệnh liền rồi, giờ làm gì?',
  'Tài khoản demo khác tài khoản thật chỗ nào?',
]

/** Golden Duck chưa có ảnh (tạo từ bản trước) thì vẫn dùng icon vịt thay cho chữ cái đầu. */
function Face({ p, size }: { p: { avatar: string; name: string }; size: number }) {
  return <Avatar src={p.avatar || (isDuck(p.name) ? DUCK_AVATAR : '')} name={p.name} size={size} />
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

/**
 * Golden Duck Talk rút gọn: một khung chat, không có phần tạo/sửa nhân vật.
 * Chưa có nhân vật nào thì tự tạo Golden Duck. Dùng chung nhân vật và lịch sử với bản đầy đủ.
 */
export default function LiteChat({ bridge, trades, infos, goFull }: Props) {
  const [store, setStore] = useState<PersonaStore | null>(null)
  const [ai, setAi] = useState<{ configured: boolean } | null>(null)
  const [picked, setPicked] = usePersistent('fx.chat.persona', '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const creating = useRef(false)

  useEffect(() => {
    if (!bridge.online) return
    bridgeGet<{ configured: boolean }>('/ai/status').then(setAi).catch(() => {})
    bridgeGet<PersonaStore>('/personas').then(async (s) => {
      // Lần đầu dùng: tạo sẵn Golden Duck để người mới không phải tự dựng nhân vật.
      if (!s.items.length && !creating.current) {
        creating.current = true
        s = await bridgePost<PersonaStore>('/personas/save', DUCK_PERSONA)
        setPicked(s.items[0]?.id ?? '')
      }
      setStore(s)
    }).catch((e) => setErr(errText(e)))
  }, [bridge.online])

  const items = store?.items ?? []
  const persona = items.find((x) => x.id === picked) ?? items.find((x) => isDuck(x.name)) ?? items[0]
  const chat = persona && store ? store.chats[persona.id] ?? [] : []
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [chat.length, busy])

  async function addDuck() {
    try {
      const s = await bridgePost<PersonaStore>('/personas/save', DUCK_PERSONA)
      setStore(s); setPicked(s.items[s.items.length - 1].id)
    } catch (e) { setErr(errText(e)) }
  }

  async function send(raw = text) {
    const msg = raw.trim()
    if (!msg || !persona || busy) return
    setBusy(true); setErr(''); setText('')
    setStore((s) => s && ({ ...s, chats: { ...s.chats, [persona.id]: [...(s.chats[persona.id] ?? []), { role: 'user', text: msg, at: Date.now() }] } }))
    try {
      const r = await bridgePost<PersonaStore & { reply: string }>('/chat', { persona: persona.id, message: msg, context: persona.use_account ? accountContext(trades, bridge.accounts, infos) : '' })
      setStore({ items: r.items, chats: r.chats })
    } catch (e) {
      setErr(`Golden Duck chưa trả lời được: ${errText(e)}`); setText(msg)
      setStore((s) => s && ({ ...s, chats: { ...s.chats, [persona.id]: (s.chats[persona.id] ?? []).slice(0, -1) } }))
    } finally { setBusy(false) }
  }

  // Chưa sẵn sàng: nói bằng lời thường, phần cài đặt kỹ thuật để ở bản đầy đủ.
  if (!bridge.online || ai?.configured === false)
    return (
      <>
        <h1>Hỏi AI</h1>
        <section className="lite-card lite-duck-intro">
          <img className="lite-duck" src={DUCK_AVATAR} alt="" />
          <strong>Golden Duck chưa sẵn sàng</strong>
          <p className="muted">
            {!bridge.online
              ? 'Để trò chuyện với AI, cần bật chương trình kết nối (bridge) trên máy tính của bạn. Việc này chỉ làm một lần.'
              : 'Chương trình kết nối đã chạy, nhưng chưa có khoá AI. Thêm khoá một lần là dùng được.'}
          </p>
          <p className="muted small">Nếu bạn ở trong một cộng đồng, nhờ người quản lý nhóm cài giúp cũng được.</p>
          <button className="primary lite-cta" onClick={() => goFull('chat')}>Xem cách cài đặt</button>
        </section>
      </>
    )

  if (!store || !persona) return (<><h1>Hỏi AI</h1>{err ? <p className="notice bad">⚠ {err}</p> : <p className="muted">Đang gọi Golden Duck…</p>}</>)

  return (
    <div className="lite-chat">
      <div className="lite-chat-head">
        <Face p={persona} size={44} />
        <div><strong>{persona.name}</strong><small className="muted">{persona.tagline}</small></div>
        {chat.length > 0 && (
          <button className="lite-link mini" onClick={async () => setStore(await bridgePost<PersonaStore>('/chat/clear', { persona: persona.id }))}>Trò chuyện mới</button>
        )}
      </div>
      {(items.length > 1 || !items.some((x) => isDuck(x.name))) && (
        <div className="lite-persona-pick" role="radiogroup" aria-label="Chọn nhân vật">
          {items.map((p) => (
            <button key={p.id} role="radio" aria-checked={p.id === persona.id} className={p.id === persona.id ? 'lchip mini active' : 'lchip mini'} onClick={() => setPicked(p.id)}>{p.name}</button>
          ))}
          {!items.some((x) => isDuck(x.name)) && <button className="lchip mini" onClick={addDuck}>+ {DUCK_NAME}</button>}
        </div>
      )}

      <div className="lite-msgs" aria-live="polite">
        {persona.greeting && <div className="msg-row bot"><Face p={persona} size={30} /><div className="bubble assistant">{persona.greeting}</div></div>}
        {chat.map((t, i) => t.role === 'user'
          ? <div key={i} className="msg-row me"><div className="bubble user">{t.text}</div></div>
          : <div key={i} className="msg-row bot"><Face p={persona} size={30} /><div className="bubble assistant">{t.text}</div></div>)}
        {busy && <div className="msg-row bot"><Face p={persona} size={30} /><div className="bubble assistant typing" aria-label="Đang trả lời"><span /><span /><span /></div></div>}
        {chat.length === 0 && !busy && (
          <div className="lite-suggest">
            <div className="lite-label">Thử hỏi:</div>
            {SUGGESTIONS.map((q) => <button key={q} className="lite-suggest-item" onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {err && <p className="notice bad">⚠ {err}</p>}
        <div ref={end} className="lite-msgs-end" />
      </div>

      <form className="lite-chat-input" onSubmit={(e) => { e.preventDefault(); send() }}>
        <textarea rows={1} value={text} placeholder={`Hỏi ${persona.name}…`} aria-label="Tin nhắn"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <button type="submit" className="primary" disabled={busy || !text.trim()} aria-label="Gửi">Gửi</button>
      </form>
      <p className="muted small lite-chat-note">AI có thể sai. Không phải lời khuyên đầu tư.{persona.use_account && ' Golden Duck xem được kết quả giao dịch của bạn để trả lời sát hơn.'}</p>
    </div>
  )
}
