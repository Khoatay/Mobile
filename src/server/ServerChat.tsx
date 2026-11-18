import { useEffect, useState } from 'react'
import ChatPane from '../lite/ChatPane'
import { isDuck, type Persona, type PersonaStore } from '../lib/persona'
import { api, type ChatReply, type Me, type MyAi } from '../lib/server'
import { usePersistent } from '../lib/store'

const SUGGESTIONS = ['Pip và lot là gì?', 'Vốn 100 đô thì nên vào bao nhiêu lot?', 'Stop loss nên đặt thế nào?', 'Kênh báo lệnh không có SL thì có nên vào?', 'Thua 2 lệnh liền rồi, giờ làm gì?']

type SrvPersona = Persona & { knowledge?: string; preset?: boolean }
type Store = { items: SrvPersona[]; chats: PersonaStore['chats'] }
const EMPTY = { name: '', tagline: '', personality: '', style: '', values: '', boundaries: '', greeting: '', knowledge: '' }

/** Hỏi AI qua máy chủ. Có sẵn vài nhân vật; khách tự tạo nhân vật riêng và dạy kiến thức (chiến lược, quy tắc của mình). */
export default function ServerChat({ me, onUsed }: { me: Me; onUsed: (remaining: number) => void }) {
  const [store, setStore] = useState<Store | null>(null)
  const [ai, setAi] = useState<MyAi | null>(null)
  const [picked, setPicked] = usePersistent('fx.srv.persona', '')
  const [edit, setEdit] = useState<(typeof EMPTY & { id?: string }) | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api<Store>('/personas').then(setStore).catch((e) => setErr(e.message))
    api<MyAi>('/ai/me').then(setAi).catch(() => {})
  }, [])
  const persona = store?.items.find((x) => x.id === picked) ?? store?.items.find((x) => isDuck(x.name)) ?? store?.items[0]

  if (edit) return <PersonaEditor value={edit} onCancel={() => setEdit(null)} onSaved={(s, id) => { setStore(s); setPicked(id); setEdit(null) }}
    onDelete={edit.id ? async () => { setStore(await api<Store>('/personas/delete', { id: edit.id })); setPicked(''); setEdit(null) } : undefined} />
  if (!store || !persona) return (<><h1>Hỏi AI</h1>{err ? <p className="notice bad">⚠ {err}</p> : <p className="muted">Đang gọi Golden Duck…</p>}</>)

  const own = ai?.mode === 'own'
  const left = Math.max(0, me.limits.chatPerDay - me.chatToday)
  return (
    <>
      <div className="srv-chat-tools">
        {me.advanced && <button className="lite-link mini" onClick={() => setEdit({ ...EMPTY })}>+ Tạo nhân vật của tôi</button>}
        {me.advanced && !persona.preset && <button className="lite-link mini" onClick={() => setEdit({ ...EMPTY, ...persona, knowledge: persona.knowledge ?? '' })}>Sửa {persona.name}</button>}
        <span className="srv-ai-chip muted small">{own ? `🔑 ${ai?.model}` : `Còn ${left}/${me.limits.chatPerDay} tin hôm nay`}</span>
      </div>
      <ChatPane store={store} setStore={(f) => setStore((s) => f(s) as Store | null)} persona={persona} setPicked={setPicked} suggestions={SUGGESTIONS}
        ask={async (p, message) => { const r = await api<ChatReply>('/chat', { persona: p.id, message }); if (r.remaining != null) onUsed(r.remaining); return r }}
        clear={(p) => api<PersonaStore>('/chat/clear', { persona: p.id })}
        note={own ? 'Đang dùng khoá AI của bạn.' : 'Câu hỏi cơ bản (pip, lot, cắt lỗ…) được trả lời ngay và không tính lượt.'} />
    </>
  )
}

function PersonaEditor({ value, onCancel, onSaved, onDelete }: { value: typeof EMPTY & { id?: string }; onCancel: () => void; onSaved: (s: Store, id: string) => void; onDelete?: () => Promise<void> }) {
  const [v, setV] = useState(value)
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await api<Store & { saved: string }>('/personas/save', v); onSaved(r, r.saved) } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <form className="srv-form srv-persona" onSubmit={save}>
      <h1>{v.id ? `Sửa ${value.name}` : 'Tạo nhân vật'}</h1>
      <label>Tên<input required maxLength={60} value={v.name} onChange={set('name')} placeholder="Ví dụ: Thầy Scalp" /></label>
      <label>Giới thiệu ngắn<input maxLength={120} value={v.tagline} onChange={set('tagline')} placeholder="Chuyên lướt sóng vàng phiên Âu" /></label>
      <label>Tính cách<textarea rows={2} value={v.personality} onChange={set('personality')} placeholder="Thẳng thắn, ngắn gọn, hay hỏi lại để mình tự nghĩ" /></label>
      <label>Cách nói chuyện, xưng hô<textarea rows={2} value={v.style} onChange={set('style')} placeholder='Xưng "anh", gọi mình là "em"' /></label>
      <label>Kiến thức dạy cho AI
        <textarea rows={8} value={v.knowledge} onChange={set('knowledge')} maxLength={30000} placeholder={'Dán chiến lược, quy tắc của bạn. Ví dụ:\n- Chỉ vào lệnh vàng 14h–17h giờ VN\n- SL tối đa 30 giá, TP gấp 2 lần SL\n- Không vào lệnh trước tin Mỹ 30 phút'} />
        <small className="muted">{v.knowledge.length.toLocaleString('vi-VN')}/30.000 ký tự. AI đọc phần này mỗi lần trả lời và bám theo nó.</small>
      </label>
      <label>Những điều không làm<textarea rows={2} value={v.boundaries} onChange={set('boundaries')} placeholder="Không khuyên vào lệnh không có SL" /></label>
      <label>Câu chào<input maxLength={500} value={v.greeting} onChange={set('greeting')} /></label>
      {err && <p className="notice bad">⚠ {err}</p>}
      <div className="srv-ai-actions">
        <button className="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu nhân vật'}</button>
        <button type="button" onClick={onCancel}>Huỷ</button>
        {onDelete && (sure
          ? <button type="button" className="danger" onClick={onDelete}>Xoá hẳn (mất cả lịch sử chat)</button>
          : <button type="button" className="lite-link danger" onClick={() => setSure(true)}>Xoá nhân vật</button>)}
      </div>
    </form>
  )
}
