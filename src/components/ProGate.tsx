import type { ReactNode } from 'react'
import Icon, { type IconName } from './Icon'
import { PRO_FEATURES } from '../lib/pro'

/** Màn hình thay cho một trang Pro khi người dùng chưa có Pro. */
export function ProLockPage({ feature, onOpenPro }: { feature: string; onOpenPro: () => void }) {
  const f = PRO_FEATURES.find((x) => x.id === feature)
  return (
    <section className="card pro-gate">
      <span className="pro-gate-icon"><Icon name={(f?.icon ?? 'sparkle') as IconName} size={28} /></span>
      <h2>{f?.name ?? 'Tính năng Pro'}</h2>
      <p className="muted">{f?.desc}</p>
      <button className="primary" onClick={onOpenPro}>Xem gói Pro</button>
    </section>
  )
}

/** Dòng nhỏ báo một lựa chọn bị khoá, dẫn về trang Gói Pro. */
export function ProNote({ children, onOpenPro }: { children: ReactNode; onOpenPro: () => void }) {
  return (
    <div className="pro-note">
      <span aria-hidden="true">🔒</span>
      <span>{children}</span>
      <button className="ghost mini" onClick={onOpenPro}>Xem gói Pro</button>
    </div>
  )
}
