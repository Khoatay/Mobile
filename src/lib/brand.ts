/**
 * Thương hiệu mặc định của app: Golden Duck.
 * Logo là icon vịt 3D trong public/ (đi kèm mọi bản build, đường dẫn tương đối nên chạy được ở bất kỳ thư mục nào).
 * IB đổi được tên, logo, khẩu hiệu và màu ở Cá nhân hoá; logo riêng đi theo gói cấu hình sang bản trader.
 */
export const BRAND_NAME = 'Golden Duck'
export const BRAND_LOGO = './golden-duck.svg'

/** Tên cũ của app. Người dùng chưa từng đổi tên thì đang lưu đúng chuỗi này, nên coi như dùng tên mặc định. */
const OLD_DEFAULT = 'FX Desk'

/** Tên hiển thị: trống hoặc còn tên mặc định cũ thì dùng Golden Duck. */
export function brandName(name: string | undefined): string {
  const n = (name ?? '').trim()
  return !n || n === OLD_DEFAULT ? BRAND_NAME : n
}

/** Tên miền gọn để hiện: bỏ https://, www. và dấu / cuối. "https://www.goldenduck.vn/" -> "goldenduck.vn". */
export const siteName = (url: string) => url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '')
/** Link đầy đủ để mở: thêm https:// nếu người dùng chỉ gõ tên miền. */
export const siteUrl = (url: string) => { const u = url.trim(); return !u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}` }

/** Logo đang dùng: logo riêng của IB nếu có, không thì Golden Duck. */
export const logoOf = (p: { logo?: string }) => p.logo?.trim() || BRAND_LOGO

/** Logo nhúng thẳng vào file (trang thành tích công khai là file HTML độc lập, không tải được ảnh từ app). */
export async function logoDataUrl(src = BRAND_LOGO): Promise<string> {
  if (src.startsWith('data:')) return src
  try {
    const res = await fetch(src)
    if (!res.ok) return ''
    const blob = await res.blob()
    return await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : '')
      r.onerror = () => resolve('')
      r.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}
