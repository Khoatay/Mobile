import { useEffect, useState } from 'react'
import ChatPane from '../lite/ChatPane'
import { isDuck, type PersonaStore } from '../lib/persona'
import { api, type ChatReply, type Me } from '../lib/server'
import { usePersistent } from '../lib/store'

const SUGGESTIONS = ['Pip và lot là gì?', 'Vốn 100 đô thì nên vào bao nhiêu lot?', 'Stop loss nên đặt thế nào?', 'Kênh báo lệnh không có SL thì có nên vào?', 'Thua 2 lệnh liền rồi, giờ làm gì?']

/** Hỏi AI qua máy chủ: dùng khoá AI của chủ app, có giới hạn lượt mỗi ngày. */
export default function ServerChat({ me, onUsed }: { me: Me; onUsed: (remaining: number) => void }) {
  const [store, setStore] = useState<PersonaStore | null>(null)
  const [picked, setPicked] = usePersistent('fx.srv.persona', '')
  const [err, setErr] = useState('')
  useEffect(() => { api<PersonaStore>('/personas').then(setStore).catch((e) => setErr(e.message)) }, [])
  const persona = store?.items.find((x) => x.id === picked) ?? store?.items.find((x) => isDuck(x.name)) ?? store?.items[0]
  if (!store || !persona) return (<><h1>Hỏi AI</h1>{err ? <p className="notice bad">⚠ {err}</p> : <p className="muted">Đang gọi Golden Duck…</p>}</>)
  const left = Math.max(0, me.limits.chatPerDay - me.chatToday)
  return (
    <ChatPane store={store} setStore={(f) => setStore((s) => f(s))} persona={persona} setPicked={setPicked} suggestions={SUGGESTIONS}
      ask={async (p, message) => { const r = await api<ChatReply>('/chat', { persona: p.id, message }); onUsed(r.remaining); return r }}
      clear={(p) => api<PersonaStore>('/chat/clear', { persona: p.id })}
      note={`Còn ${left}/${me.limits.chatPerDay} tin hôm nay.`} />
  )
}
