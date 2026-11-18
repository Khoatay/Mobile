/** Hồ sơ người dùng. Hiện lưu trên máy này; khi có máy chủ sẽ gắn với tài khoản đăng nhập. */
export interface UserProfile {
  displayName: string
  username: string
  /** Ảnh vuông 256px dạng data URL (JPEG). Rỗng thì dùng chữ cái đầu. */
  avatar: string
  bio: string
  style: string
  experience: string
  markets: string[]
  telegram: string
  facebook: string
}

export const DEFAULT_USER: UserProfile = { displayName: '', username: '', avatar: '', bio: '', style: '', experience: '', markets: [], telegram: '', facebook: '' }
export const STYLES = ['Scalping', 'Day trade', 'Swing', 'Position', 'Chạy EA', 'Thi quỹ']
export const EXPERIENCE = ['Dưới 1 năm', '1–3 năm', '3–5 năm', 'Trên 5 năm']
export const MARKETS = ['Vàng', 'Cặp chính', 'Cặp chéo', 'Chỉ số', 'Crypto', 'Dầu']

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** Tên người dùng: chữ thường, số, dấu chấm và gạch dưới, 3–20 ký tự. */
export const validUsername = (u: string) => /^[a-z0-9._]{3,20}$/.test(u)

/** Cắt ảnh thành hình vuông ở giữa và thu về 256px, để lưu gọn trong trình duyệt. `png` giữ nền trong suốt (dùng cho logo). */
export function squareAvatar(file: File, size = 256, png = false): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Hãy chọn một file ảnh'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const c = document.createElement('canvas')
      c.width = c.height = size
      const g = c.getContext('2d')!
      g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh này')) }
    img.src = url
  })
}
