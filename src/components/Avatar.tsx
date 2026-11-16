import { initials } from '../lib/user'

export default function Avatar({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  return src
    ? <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className="avatar avatar-empty" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>
}
