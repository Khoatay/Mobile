/**
 * Thương hiệu mặc định của app: Golden Duck.
 * Logo là icon vịt 3D trong public/ (đi kèm mọi bản build, đường dẫn tương đối nên chạy được ở bất kỳ thư mục nào).
 * IB vẫn đổi được tên, khẩu hiệu và màu ở Cá nhân hoá; logo luôn là vịt.
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

/** Logo nhúng thẳng vào file (trang thành tích công khai là file HTML độc lập, không tải được ảnh từ app). */
export async function logoDataUrl(): Promise<string> {
  try {
    const res = await fetch(BRAND_LOGO)
    if (!res.ok) return ''
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(await res.text())))}`
  } catch {
    return ''
  }
}
