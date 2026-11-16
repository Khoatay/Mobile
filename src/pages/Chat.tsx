import { useEffect, useRef, useState } from 'react'
import Avatar from '../components/Avatar'
import { Field } from '../components/Field'
import { ask } from '../lib/ask'
import type { InfoMap } from '../lib/accounts'
import { bridgeGet, bridgePost, type BridgeState } from '../lib/bridge'
import type { Playbook } from '../lib/kb'
import { accountContext, BLANK_PERSONA, PERSONA_TEMPLATES, type Persona, type PersonaStore } from '../lib/persona'
import { usePersistent } from '../lib/store'
import type { Trade } from '../lib/types'
import { squareAvatar } from '../lib/user'
import { AiSetup } from './Learn'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')

function Editor({ value, books, onSave, onCancel, onDelete }: { value: Partial<Persona>; books: Playbook[]; onSave: (p: Partial<Persona>) => void; onCancel: () => void; onDelete?: () => void }) {
  const [p, setP] = useState<Partial<Persona>>(value)
  const set = (x: Partial<Persona>) => setP({ ...p, ...x })
  const file = useRef<HTMLInputElement>(null)
  const area = (label: string, key: keyof Persona, hint: string, rows = 3, placeholder = '') => (
    <Field label={label} hint={hint}><textarea rows={rows} value={String(p[key] ?? '')} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<Persona>)} /></Field>
  )
  return (
    <section className="card persona-editor">
      <div className="persona-editor-head">
        <button className="avatar-pick" onClick={() => file.current?.click()} aria-label="Đổi ảnh nhân vật"><Avatar src={p.avatar} name={p.name || '?'} size={84} /><span className="avatar-edit">Đổi ảnh</span></button>
        <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) set({ avatar: await squareAvatar(f) }) }} />
        <div className="form" style={{ flex: 1 }}>
          <div className="row">
            <Field label="Tên nhân vật"><input value={p.name ?? ''} maxLength={40} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Một dòng giới thiệu"><input value={p.tagline ?? ''} maxLength={100} onChange={(e) => set({ tagline: e.target.value })} /></Field>
          </div>
          {!value.id && (
            <div className="chips">
              <span className="muted small">Bắt đầu từ mẫu:</span>
              {PERSONA_TEMPLATES.map((t) => <button key={t.id} className="chip-toggle" onClick={() => setP({ ...t.p, avatar: p.avatar })}>{t.label}</button>)}
            </div>
          )}
        </div>
      </div>
      <div className="persona-grid">
        {area('Tính cách', 'personality', 'Nhân vật là người thế nào', 3, 'Điềm tĩnh, thẳng thắn, hay hỏi lại…')}
        {area('Giá trị và phẩm giá', 'values', 'Nguyên tắc nhân vật luôn giữ, kể cả khi bạn yêu cầu khác', 3, 'Kỷ luật trên hết. Không cổ vũ gỡ lỗ…')}
        {area('Cách nói chuyện', 'style', 'Xưng hô, độ dài câu, có dùng emoji không', 2, 'Xưng "mình", gọi "bạn". Câu ngắn…')}
        {area('Những điều không làm', 'boundaries', 'Giới hạn rõ ràng', 2, 'Không đưa tín hiệu chắc thắng…')}
        {area('Câu chào', 'greeting', 'Hiện khi bắt đầu cuộc trò chuyện', 2)}
        {area('Hội thoại mẫu', 'examples', 'Vài lượt hỏi đáp để nhân vật bắt đúng giọng', 4, 'Bạn: …\nNhân vật: …')}
      </div>
      <div>
        <div className="field-label">Kiến thức dùng khi trò chuyện</div>
        <div className="chips" style={{ marginTop: 6 }}>
          {books.length === 0 && <span className="muted small">Chưa có bộ kiến thức nào. Tạo ở trang AI học trade.</span>}
          {books.map((b) => { const on = (p.playbooks ?? []).includes(b.id); return <button key={b.id} className={on ? 'chip-toggle on' : 'chip-toggle'} aria-pressed={on} onClick={() => set({ playbooks: on ? (p.playbooks ?? []).filter((x) => x !== b.id) : [...(p.playbooks ?? []), b.id] })}>{b.name}</button> })}
        </div>
      </div>
      <label className="inline wrap" style={{ marginTop: 10 }}><input type="checkbox" className="check" checked={p.use_account ?? true} onChange={(e) => set({ use_account: e.target.checked })} /> Cho nhân vật xem bối cảnh tài khoản (thống kê 30 ngày, kết quả hôm nay, lệnh đang mở)</label>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="primary" disabled={!p.name?.trim()} onClick={() => onSave(p)}>Lưu nhân vật</button>
        <button className="ghost" onClick={onCancel}>Huỷ</button>
        {onDelete && <button className="ghost danger" onClick={onDelete}>Xoá nhân vật</button>}
      </div>
    </section>
  )
}

export default function Chat({ bridge, trades, infos }: { bridge: BridgeState; trades: Trade[]; infos: InfoMap }) {
  const [store, setStore] = useState<PersonaStore>({ items: [], chats: {} })
  const [books, setBooks] = useState<Playbook[]>([])
  const [ai, setAi] = useState<{ configured: boolean } | null>(null)
  const [picked, setPicked] = usePersistent('fx.chat.persona', '')
  const [editing, setEditing] = useState<Partial<Persona> | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!bridge.online) return
    bridgeGet<PersonaStore>('/personas').then((s) => { setStore(s); if (!s.items.length) setEditing({ ...PERSONA_TEMPLATES[0].p }) }).catch((e) => setErr(errText(e)))
    bridgeGet<Playbook[]>('/kb').then(setBooks).catch(() => {})
    bridgeGet<{ configured: boolean }>('/ai/status').then(setAi).catch(() => {})
  }, [bridge.online])

  const persona = store.items.find((x) => x.id === picked) ?? store.items[0]
  const chat = persona ? store.chats[persona.id] ?? [] : []
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [chat.length, busy])

  async function save(p: Partial<Persona>) {
    try {
      const s = await bridgePost<PersonaStore>('/personas/save', p)
      setStore(s); setEditing(null)
      if (!p.id) setPicked(s.items[s.items.length - 1].id)
    } catch (e) { setErr(errText(e)) }
  }
  async function send() {
    const msg = text.trim()
    if (!msg || !persona || busy) return
    setBusy(true); setErr(''); setText('')
    setStore((s) => ({ ...s, chats: { ...s.chats, [persona.id]: [...(s.chats[persona.id] ?? []), { role: 'user', text: msg, at: Date.now() }] } }))
    try {
      const r = await bridgePost<PersonaStore & { reply: string }>('/chat', { persona: persona.id, message: msg, context: persona.use_account ? accountContext(trades, bridge.accounts, infos) : '' })
      setStore({ items: r.items, chats: r.chats })
    } catch (e) {
      setErr(errText(e)); setText(msg)
      setStore((s) => ({ ...s, chats: { ...s.chats, [persona.id]: (s.chats[persona.id] ?? []).slice(0, -1) } }))
    } finally { setBusy(false) }
  }

  if (!bridge.online) return (<><h1>Vịt Vàng Talk</h1><AiSetup online={false} /></>)
  return (
    <>
      <h1>Vịt Vàng Talk</h1>
      <p className="muted">Trò chuyện với nhân vật AI do chính bạn tạo: tính cách, phẩm giá, cách nói chuyện và kiến thức trade đều do bạn dạy.</p>
      {ai && !ai.configured && <AiSetup online />}
      {err && <p className="notice bad">⚠ {err}</p>}
      <div className="chat-layout">
        <aside className="persona-list">
          {store.items.map((p) => (
            <button key={p.id} className={p.id === persona?.id && !editing ? 'persona-item active' : 'persona-item'} onClick={() => { setPicked(p.id); setEditing(null) }}>
              <Avatar src={p.avatar} name={p.name} size={40} />
              <span><strong>{p.name}</strong><small>{p.tagline}</small></span>
            </button>
          ))}
          <button className="persona-item add" onClick={() => setEditing({ ...BLANK_PERSONA })}>+ Tạo nhân vật</button>
        </aside>

        {editing ? (
          <Editor value={editing} books={books} onSave={save} onCancel={() => setEditing(null)}
            onDelete={editing.id ? async () => { if (await ask(`Xoá nhân vật "${editing.name}" và toàn bộ cuộc trò chuyện?`, 'Xoá', true)) { setStore(await bridgePost<PersonaStore>('/personas/delete', { id: editing.id })); setEditing(null) } } : undefined} />
        ) : persona ? (
          <section className="card chat-panel">
            <header className="chat-head">
              <Avatar src={persona.avatar} name={persona.name} size={44} />
              <div><strong>{persona.name}</strong><small className="muted">{persona.tagline}</small></div>
              <div className="actions">
                {persona.use_account && <span className="chip" title="Nhân vật thấy thống kê và lệnh đang mở">Thấy tài khoản</span>}
                {persona.playbooks.length > 0 && <span className="chip">{persona.playbooks.length} bộ kiến thức</span>}
                <button className="ghost mini" onClick={() => setEditing(persona)}>Sửa nhân cách</button>
                <button className="ghost mini" disabled={!chat.length} onClick={async () => { if (await ask('Xoá toàn bộ cuộc trò chuyện với nhân vật này?', 'Xoá', true)) setStore(await bridgePost<PersonaStore>('/chat/clear', { persona: persona.id })) }}>Xoá hội thoại</button>
              </div>
            </header>
            <div className="chat-scroll">
              {persona.greeting && <div className="msg-row bot"><Avatar src={persona.avatar} name={persona.name} size={30} /><div className="bubble assistant">{persona.greeting}</div></div>}
              {chat.map((t, i) => t.role === 'user'
                ? <div key={i} className="msg-row me"><div className="bubble user">{t.text}</div></div>
                : <div key={i} className="msg-row bot"><Avatar src={persona.avatar} name={persona.name} size={30} /><div className="bubble assistant">{t.text}</div></div>)}
              {busy && <div className="msg-row bot"><Avatar src={persona.avatar} name={persona.name} size={30} /><div className="bubble assistant typing"><span /><span /><span /></div></div>}
              <div ref={end} />
            </div>
            <div className="chat-input">
              <textarea rows={2} value={text} placeholder={`Nhắn cho ${persona.name}…`} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
              <button className="primary" disabled={busy || !text.trim() || ai?.configured === false} onClick={send}>Gửi</button>
            </div>
            <p className="muted small">Enter để gửi, Shift+Enter để xuống dòng. Mỗi tin nhắn là một lần gọi API.</p>
          </section>
        ) : null}
      </div>
    </>
  )
}
