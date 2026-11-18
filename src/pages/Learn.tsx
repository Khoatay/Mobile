import AiSettings from '../components/AiSettings'
import { useEffect, useRef, useState } from 'react'
import { Field } from '../components/Field'
import RuleText from '../components/RuleText'
import { ask } from '../lib/ask'
import { bridgeGet, bridgePost, type BridgeState } from '../lib/bridge'
import { TEMPLATES, type Playbook } from '../lib/kb'
import { SERVER } from '../lib/server'
import BridgeLink from '../server/BridgeLink'
import { download } from '../lib/store'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ')
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`)
const KIND = { pdf: 'PDF', text: 'Văn bản', transcript: 'Phụ đề video' }

/**
 * Lấy chữ từ file JSON do AI khác xuất ra (lịch sử chat của ChatGPT, Gemini…):
 * gom mọi đoạn văn bản đủ dài, bỏ id, ngày giờ và các trường kỹ thuật.
 */
export function jsonToText(raw: string): string {
  const out: string[] = []
  const walk = (v: unknown, key = '') => {
    if (typeof v === 'string') {
      const t = v.trim()
      if (t.length >= 20 && !/^(id|.*_id|uuid|url|.*time|.*date|model.*|type|status)$/i.test(key) && !/^[\w-]{20,}$/.test(t)) out.push(t)
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  walk(JSON.parse(raw))
  return [...new Set(out)].join('\n\n')
}

function readFile(f: File, as: 'text' | 'dataurl'): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error(`Không đọc được ${f.name}`))
    if (as === 'text') r.readAsText(f)
    else r.readAsDataURL(f)
  })
}

export function AiSetup({ online }: { online: boolean }) {
  // Bản web: AI đi qua máy chủ; chỉ cần nối máy chạy bridge.
  if (SERVER) return online ? <p className="notice">Đang chờ bridge báo trạng thái AI…</p> : <BridgeLink />
  // Bridge đang chạy: nhập khoá ngay trong app. Chưa chạy bridge thì hướng dẫn cài bridge.
  if (online) return <AiSettings compact />
  return (
    <section className="card">
      <h3>{online ? 'Chưa có khoá API cho phần AI' : 'Cần chạy chương trình nền (bridge)'}</h3>
      <p className="muted">Phần học và phân tích dùng mô hình AI Claude qua bridge, để khoá API nằm trên máy bạn chứ không ở trình duyệt.</p>
      <ol className="steps">
        <li>Tạo khoá API tại console.anthropic.com (mục API Keys). Mỗi lần học hay phân tích tốn một khoản phí nhỏ theo lượng chữ gửi đi.</li>
        <li>Mở <code>bridge/config.json</code>, thêm dòng <code>"anthropic_api_key": "sk-ant-…",</code> ngay sau dấu <code>{'{'}</code> đầu tiên.</li>
        <li>Trong thư mục <code>bridge</code> chạy <code>pip install -r requirements.txt</code>, rồi chạy lại <code>python bridge.py</code>.</li>
      </ol>
    </section>
  )
}

export default function Learn({ bridge }: { bridge: BridgeState }) {
  const [books, setBooks] = useState<Playbook[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [ai, setAi] = useState<{ configured: boolean; model: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [paste, setPaste] = useState('')
  const [pasteName, setPasteName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [template, setTemplate] = useState('ict')
  const fileInput = useRef<HTMLInputElement>(null)
  const rulesInput = useRef<HTMLInputElement>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  const load = () => bridgeGet<Playbook[]>('/kb').then((b) => { setBooks(b); setErr('') }).catch((e) => setErr(errText(e)))
  useEffect(() => {
    if (!bridge.online) return
    load()
    bridgeGet<{ configured: boolean; model: string }>('/ai/status').then(setAi).catch(() => setAi(null))
  }, [bridge.online])

  const book = books?.find((b) => b.id === pick) ?? books?.[0]
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [book?.chat.length])
  const replace = (pb: Playbook) => setBooks((all) => (all ?? []).map((b) => (b.id === pb.id ? pb : b)))

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setErr('')
    try { await fn() } catch (e) { setErr(errText(e)) } finally { setBusy('') }
  }

  const create = () => run('Đang tạo…', async () => {
    const t = TEMPLATES.find((x) => x.id === template)!
    const pb = await bridgePost<Playbook>('/kb/save', { name: newName.trim() || t.name, rules: t.rules })
    setBooks((all) => [...(all ?? []), pb]); setPick(pb.id); setNewName('')
  })

  const remove = async () => {
    if (!book || !(await ask(`Xoá bộ kiến thức "${book.name}" cùng mọi tài liệu và lịch sử trò chuyện của nó?`, 'Xoá', true))) return
    run('Đang xoá…', async () => { await bridgePost('/kb/delete', { id: book.id }); setBooks((all) => (all ?? []).filter((b) => b.id !== book.id)); setPick(null) })
  }

  const upload = (files: FileList) => run('Đang nạp tài liệu…', async () => {
    let pb = book!
    for (const f of Array.from(files)) {
      const lower = f.name.toLowerCase()
      if (lower.endsWith('.pdf')) pb = await bridgePost<Playbook>('/kb/source', { playbook: pb.id, kind: 'pdf', name: f.name, data: await readFile(f, 'dataurl') })
      else if (/\.(srt|vtt)$/.test(lower)) pb = await bridgePost<Playbook>('/kb/source', { playbook: pb.id, kind: 'transcript', name: f.name, text: await readFile(f, 'text') })
      else if (/\.(txt|md)$/.test(lower)) pb = await bridgePost<Playbook>('/kb/source', { playbook: pb.id, kind: 'text', name: f.name, text: await readFile(f, 'text') })
      else if (lower.endsWith('.json')) {
        let text = ''
        try { text = jsonToText(await readFile(f, 'text')) } catch { throw new Error(`${f.name}: file JSON bị lỗi`) }
        if (!text) throw new Error(`${f.name}: không tìm thấy nội dung chữ trong file`)
        pb = await bridgePost<Playbook>('/kb/source', { playbook: pb.id, kind: 'text', name: f.name, text })
      } else throw new Error(`${f.name}: chỉ nhận PDF, TXT, MD, JSON, SRT, VTT`)
    }
    replace(pb)
  })

  const addPaste = () => run('Đang lưu…', async () => {
    const isSub = /-->/.test(paste)
    const pb = await bridgePost<Playbook>('/kb/source', { playbook: book!.id, kind: isSub ? 'transcript' : 'text', name: pasteName.trim() || (isSub ? 'Phụ đề dán vào' : 'Ghi chú dán vào'), text: paste })
    replace(pb); setPaste(''); setPasteName('')
  })

  const removeSource = (sid: string) => run('Đang xoá…', async () => replace(await bridgePost<Playbook>('/kb/source/delete', { playbook: book!.id, source: sid })))

  const send = (text: string) => run('Agent đang đọc và trả lời…', async () => {
    const r = await bridgePost<{ playbook: Playbook }>('/kb/learn', { playbook: book!.id, message: text })
    replace(r.playbook); setMsg('')
  })

  const saveRules = () => run('Đang lưu…', async () => { replace(await bridgePost<Playbook>('/kb/save', { id: book!.id, rules: editing })); setEditing(null) })

  if (!bridge.online) return (<><h1>AI học trade</h1><AiSetup online={false} /></>)

  return (
    <>
      <h1>AI học trade</h1>
      <p className="muted">Dạy agent phương pháp của bạn (ICT, SMC, hoặc kết hợp nhiều trường phái) bằng tài liệu PDF, phụ đề video và trò chuyện. Agent tóm thành một bộ quy tắc rõ ràng; trang AI phân tích chỉ áp dụng đúng bộ quy tắc đó.</p>
      {ai && !ai.configured && <AiSetup online />}
      {err && <p className="notice bad">⚠ {err}</p>}

      <div className="tabs" role="tablist" aria-label="Bộ kiến thức">
        {(books ?? []).map((b) => (
          <button key={b.id} role="tab" aria-selected={b.id === book?.id} className={b.id === book?.id ? 'tab active' : 'tab'} onClick={() => { setPick(b.id); setEditing(null) }}>
            {b.name}<small>{b.sources.length} tài liệu</small>
          </button>
        ))}
        <button role="tab" aria-selected={!book} className={!book ? 'tab active add' : 'tab add'} onClick={() => setPick('__new')}>+ Bộ kiến thức mới</button>
      </div>

      {(!book || pick === '__new') ? (
        <section className="card">
          <h3>Tạo bộ kiến thức</h3>
          <div className="prop-form">
            <Field label="Tên"><input value={newName} placeholder="VD: ICT của tôi, SMC + Wyckoff" onChange={(e) => setNewName(e.target.value)} /></Field>
            <Field label="Bắt đầu từ">
              <select value={template} onChange={(e) => setTemplate(e.target.value)}>{TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </Field>
          </div>
          <p className="muted small">Bộ mẫu chỉ là điểm xuất phát chung, chưa phải cách bạn giao dịch. Sau khi tạo, hãy nạp tài liệu và dạy lại để agent sửa cho đúng.</p>
          <button className="primary" disabled={!!busy} onClick={create}>Tạo</button>
        </section>
      ) : (
        <div className="learn">
          <div className="learn-col">
            <section className="card">
              <div className="card-head">
                <h3>Tài liệu nguồn</h3>
                <div className="actions">
                  <button className="primary" disabled={!!busy} onClick={() => fileInput.current?.click()}>Nạp file…</button>
                </div>
              </div>
              <input ref={fileInput} type="file" multiple hidden accept=".pdf,.txt,.md,.json,.srt,.vtt" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
              <p className="muted small">PDF khoá học, ghi chú (.txt, .md), nội dung xuất từ AI khác như ChatGPT hay Gemini (.json, .md, .txt), phụ đề video (.srt, .vtt). Video YouTube: tải phụ đề về (nhiều công cụ miễn phí làm được), hoặc dán lời thoại vào ô bên dưới.</p>
              {book.sources.length === 0 ? <p className="muted">Chưa có tài liệu nào.</p> : (
                <ul className="sources">
                  {book.sources.map((s) => (
                    <li key={s.id}><span className="chip">{KIND[s.kind]}</span> <span className="src-name">{s.name}</span> <span className="muted small">{kb(s.size)}</span>
                      <button className="ghost icon" aria-label={`Xoá ${s.name}`} disabled={!!busy} onClick={() => removeSource(s.id)}>✕</button></li>
                  ))}
                </ul>
              )}
              <details className="guide">
                <summary>Dán văn bản hoặc phụ đề</summary>
                <Field label="Tên"><input value={pasteName} placeholder="VD: Bài 3 - Liquidity" onChange={(e) => setPasteName(e.target.value)} /></Field>
                <textarea rows={6} value={paste} placeholder="Dán nội dung vào đây…" onChange={(e) => setPaste(e.target.value)} />
                <button disabled={!!busy || !paste.trim()} onClick={addPaste} style={{ marginTop: 8 }}>Lưu vào tài liệu</button>
              </details>
            </section>

            <section className="card chat">
              <h3>Dạy qua trò chuyện</h3>
              <div className="chat-log">
                {book.chat.length === 0 && <p className="muted">Kể cho agent cách bạn vào lệnh: khung thời gian nào, chờ tín hiệu gì, đặt SL, TP ra sao. Agent sẽ hỏi lại chỗ còn mơ hồ.</p>}
                {book.chat.map((t, i) => <div key={i} className={`bubble ${t.role}`}>{t.text}</div>)}
                {busy.startsWith('Agent') && <div className="bubble assistant muted">{busy}</div>}
                <div ref={chatEnd} />
              </div>
              <textarea rows={3} value={msg} placeholder="VD: Tôi chỉ vào lệnh phiên London, sau khi giá quét đáy phiên Á rồi có CHoCH trên M5…" onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && msg.trim()) send(msg.trim()) }} />
              <div className="actions" style={{ marginTop: 8 }}>
                <button className="primary" disabled={!!busy || !msg.trim() || ai?.configured === false} onClick={() => send(msg.trim())}>Gửi</button>
                <button disabled={!!busy || !book.sources.length || ai?.configured === false} onClick={() => send('Hãy đọc toàn bộ tài liệu nguồn và tổng hợp lại bộ quy tắc đầy đủ. Liệt kê những chỗ tài liệu chưa rõ hoặc mâu thuẫn để tôi xác nhận.')}>Tổng hợp từ tài liệu</button>
                <span className="muted small">Ctrl+Enter để gửi. Mỗi lần gửi, agent đọc lại toàn bộ tài liệu của bộ này.</span>
              </div>
            </section>
          </div>

          <section className="card learn-rules">
            <div className="card-head">
              <h3>Bộ quy tắc</h3>
              <div className="actions">
                {editing == null ? <button onClick={() => setEditing(book.rules)}>Sửa tay</button> : (
                  <><button className="primary" disabled={!!busy} onClick={saveRules}>Lưu</button><button className="ghost" onClick={() => setEditing(null)}>Huỷ</button></>
                )}
                <button className="ghost" disabled={!book.rules.trim()} onClick={() => download(`${book.name}.md`, `# ${book.name}\n\n${book.rules}\n`, 'text/markdown')}>Xuất .md</button>
                <button className="ghost" disabled={!!busy} onClick={() => rulesInput.current?.click()}>Nhập quy tắc</button>
                <button className="ghost danger" disabled={!!busy} onClick={remove}>Xoá bộ</button>
              </div>
            </div>
            <input ref={rulesInput} type="file" hidden accept=".md,.txt" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (!f) return
              const text = (await readFile(f, 'text')).replace(/^#\s+.*\n+/, '')
              if (book.rules.trim() && !(await ask(`Thay bộ quy tắc hiện tại bằng nội dung của ${f.name}? Bạn vẫn sửa được trước khi lưu.`, 'Thay'))) return
              setEditing(text)
            }} />
            {editing != null ? <textarea className="rules-edit" rows={24} value={editing} onChange={(e) => setEditing(e.target.value)} />
              : book.rules.trim() ? <RuleText text={book.rules} /> : <p className="muted">Chưa có quy tắc. Nạp tài liệu rồi bấm "Tổng hợp từ tài liệu", hoặc kể cho agent qua trò chuyện.</p>}
            <p className="muted small">Dòng in nghiêng là điều agent tự suy ra, cần bạn xác nhận. Bạn sửa tay được bất cứ lúc nào; agent sẽ dựa trên bản bạn sửa ở lần dạy tiếp theo.</p>
          </section>
        </div>
      )}
      {busy && !busy.startsWith('Agent') && <p className="muted small">{busy}</p>}
    </>
  )
}
