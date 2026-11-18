import { useEffect, useRef, useState } from 'react'
import type { InfoMap } from '../lib/accounts'
import { bridgeGet, bridgePost, type BridgeState } from '../lib/bridge'
import { accountContext, DUCK_AVATAR, DUCK_PERSONA, isDuck, seedPersonas, type PersonaStore } from '../lib/persona'
import { usePersistent } from '../lib/store'
import type { Trade } from '../lib/types'
import ChatPane, { errText } from './ChatPane'

interface Props { bridge: BridgeState; trades: Trade[]; infos: InfoMap; goFull: (tab?: string) => void }

/**
 * Golden Duck Talk rút gọn: một khung chat, không có phần tạo/sửa nhân vật.
 * Chưa có nhân vật nào thì tự tạo Golden Duck. Dùng chung nhân vật và lịch sử với bản đầy đủ.
 */
export default function LiteChat({ bridge, trades, infos, goFull }: Props) {
  const [store, setStore] = useState<PersonaStore | null>(null)
  const [ai, setAi] = useState<{ configured: boolean } | null>(null)
  const [picked, setPicked] = usePersistent('fx.chat.persona', '')
  const [err, setErr] = useState('')
  const creating = useRef(false)

  useEffect(() => {
    if (!bridge.online) return
    bridgeGet<{ configured: boolean }>('/ai/status').then(setAi).catch(() => {})
    bridgeGet<PersonaStore>('/personas').then(async (s) => {
      // Lần đầu dùng: tạo sẵn Golden Duck để người mới không phải tự dựng nhân vật.
      if (!s.items.length && !creating.current) {
        creating.current = true
        s = await seedPersonas((p) => bridgePost<PersonaStore>('/personas/save', p))
        setPicked(s.items.find((x) => isDuck(x.name))?.id ?? s.items[0]?.id ?? '')
      }
      setStore(s)
    }).catch((e) => setErr(errText(e)))
  }, [bridge.online])

  const items = store?.items ?? []
  const persona = items.find((x) => x.id === picked) ?? items.find((x) => isDuck(x.name)) ?? items[0]

  async function addDuck() {
    try {
      const s = await bridgePost<PersonaStore>('/personas/save', DUCK_PERSONA)
      setStore(s); setPicked(s.items[s.items.length - 1].id)
    } catch (e) { setErr(errText(e)) }
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
    <ChatPane store={store} setStore={setStore} persona={persona} setPicked={setPicked} addDuck={addDuck}
      ask={(p, message) => bridgePost<PersonaStore>('/chat', { persona: p.id, message, context: p.use_account ? accountContext(trades, bridge.accounts, infos) : '' })}
      clear={(p) => bridgePost<PersonaStore>('/chat/clear', { persona: p.id })}
      note={persona.use_account ? 'Golden Duck xem được kết quả giao dịch của bạn để trả lời sát hơn.' : ''} />
  )
}
