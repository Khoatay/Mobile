/**
 * Hộp xác nhận tự vẽ, thay cho confirm() của trình duyệt (bị chặn trong một số khung nhúng).
 * Trả về true khi người dùng bấm nút đồng ý. Enter = đồng ý, Esc hoặc bấm ra ngoài = huỷ.
 */
export function ask(message: string, okLabel = 'Đồng ý', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null
    const overlay = document.createElement('div')
    overlay.className = 'ask-overlay'
    const box = document.createElement('div')
    box.className = 'ask-box'
    box.setAttribute('role', 'alertdialog')
    box.setAttribute('aria-modal', 'true')
    const text = document.createElement('p')
    text.className = 'ask-text'
    text.textContent = message
    text.id = 'ask-text'
    box.setAttribute('aria-describedby', 'ask-text')
    const row = document.createElement('div')
    row.className = 'actions ask-actions'
    const cancel = document.createElement('button')
    cancel.textContent = 'Huỷ'
    const ok = document.createElement('button')
    ok.textContent = okLabel
    ok.className = danger ? 'primary danger-fill' : 'primary'
    row.append(cancel, ok)
    box.append(text, row)
    overlay.append(box)
    document.body.append(overlay)
    ok.focus()

    const done = (v: boolean) => {
      document.removeEventListener('keydown', onKey, true)
      overlay.remove()
      prev?.focus?.()
      resolve(v)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false) }
      else if (e.key === 'Enter' && document.activeElement !== cancel) { e.preventDefault(); done(true) }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === ok ? cancel : ok).focus() }
    }
    document.addEventListener('keydown', onKey, true)
    cancel.onclick = () => done(false)
    ok.onclick = () => done(true)
    overlay.onclick = (e) => { if (e.target === overlay) done(false) }
  })
}
