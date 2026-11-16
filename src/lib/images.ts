/** Thu nhỏ ảnh để lưu gọn trong gói cấu hình: giữ tỷ lệ, cạnh dài tối đa maxW × maxH, xuất JPEG. */
export function resizeImage(file: File, maxW = 1200, maxH = 800, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Hãy chọn một file ảnh'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, maxW / img.width, maxH / img.height)
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k)
      c.height = Math.round(img.height * k)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh này')) }
    img.src = url
  })
}

/** Tải ảnh (data URL hoặc http) thành HTMLImageElement để vẽ lên canvas; lỗi thì trả null. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}
