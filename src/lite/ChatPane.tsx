import { useEffect, useRef, useState } from 'react'
import Avatar from '../components/Avatar'
import { DUCK_AVATAR, DUCK_NAME, isDuck, type Persona, type PersonaStore } from '../lib/persona'

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
export function Face({ p, size }: { p: { avatar: string; name: string }; size: number }) {
  return <Avatar src={p.avatar || (isDuck(p.name) ? DUCK_AVATAR : '')} name={p.name} size={size} />
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

interface Props {
  store: PersonaStore
  setStore: (f: (s: PersonaStore | null) => PersonaStore | null) => void
  persona: Persona
  setPicked: (id: string) => void
  /** Gửi tin, trả về kho mới (đã có câu trả lời). */
  ask: (persona: Persona, message: string) => Promise<PersonaStore>
  clear: (persona: Persona) => Promise<PersonaStore>
  addDuck?: () => void
  suggestions?: string[]
  note?: string
}

/** Khung chat dùng chung cho bản đơn giản (qua bridge) và bản máy chủ. */
export default function ChatPane({ store, setStore, persona, setPicked, ask, clear, addDuck, suggestions = SUGGESTIONS, note }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const items = store.items
  const chat = store.chats[persona.id] ?? []
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [chat.length, busy])

  async function send(raw = text) {
    const msg = raw.trim()
    if (!msg || busy) return
    setBusy(true); setErr(''); setText('')
    setStore((s) => s && ({ ...s, chats: { ...s.chats, [persona.id]: [...(s.chats[persona.id] ?? []), { role: 'user', text: msg, at: Date.now() }] } }))
    try {
      const r = await ask(persona, msg)
      setStore(() => ({ items: r.items, chats: r.chats }))
    } catch (e) {
      setErr(`${persona.name} chưa trả lời được: ${errText(e)}`); setText(msg)
      setStore((s) => s && ({ ...s, chats: { ...s.chats, [persona.id]: (s.chats[persona.id] ?? []).slice(0, -1) } }))
    } finally { setBusy(false) }
  }

  return (
    <div className="lite-chat">
      <div className="lite-chat-head">
        <Face p={persona} size={44} />
        <div><strong>{persona.name}</strong><small className="muted">{persona.tagline}</small></div>
        {chat.length > 0 && (
          <button className="lite-link mini" onClick={async () => { try { const s = await clear(persona); setStore(() => s) } catch (e) { setErr(errText(e)) } }}>Trò chuyện mới</button>
        )}
      </div>
      {(items.length > 1 || (addDuck && !items.some((x) => isDuck(x.name)))) && (
        <div className="lite-persona-pick" role="radiogroup" aria-label="Chọn nhân vật">
          {items.map((p) => (
            <button key={p.id} role="radio" aria-checked={p.id === persona.id} className={p.id === persona.id ? 'lchip mini active' : 'lchip mini'} onClick={() => setPicked(p.id)}>{p.name}</button>
          ))}
          {addDuck && !items.some((x) => isDuck(x.name)) && <button className="lchip mini" onClick={addDuck}>+ {DUCK_NAME}</button>}
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
            {suggestions.map((q) => <button key={q} className="lite-suggest-item" onClick={() => send(q)}>{q}</button>)}
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
      <p className="muted small lite-chat-note">AI có thể sai. Không phải lời khuyên đầu tư.{note && ` ${note}`}</p>
    </div>
  )
}
