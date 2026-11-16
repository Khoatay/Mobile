import { useRef, useState } from 'react'
import { resizeImage } from '../lib/images'

/** Chọn ảnh feature: tải file lên (tự thu nhỏ) hoặc dán link ảnh. */
export default function ImagePick({ value, onChange, ratio = '16 / 9', label = 'Ảnh feature' }: { value: string; onChange: (v: string) => void; ratio?: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState('')
  const pick = async (f: File) => {
    try { onChange(await resizeImage(f)); setErr('') } catch (e) { setErr(e instanceof Error ? e.message : 'Lỗi không rõ') }
  }
  return (
    <div className="image-pick">
      <div className="field-label">{label}</div>
      <button type="button" className="image-drop" style={{ aspectRatio: ratio }} onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) pick(f) }}>
        {value ? <img src={value} alt="" /> : <span>Bấm hoặc kéo ảnh vào đây<small>Nên dùng ảnh ngang, tối thiểu 1200 × 675</small></span>}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }} />
      <div className="actions" style={{ marginTop: 6 }}>
        <input aria-label="Hoặc dán link ảnh" value={value.startsWith('data:') ? '' : value} placeholder={value.startsWith('data:') ? 'Đang dùng ảnh đã tải lên' : 'Hoặc dán link ảnh https://…'} onChange={(e) => onChange(e.target.value.trim())} />
        {value && <button type="button" className="ghost" onClick={() => onChange('')}>Bỏ ảnh</button>}
      </div>
      {err && <p className="notice bad">⚠ {err}</p>}
    </div>
  )
}
