/** Danh sách tính năng có thể đặt là Pro. IB chọn tính năng nào là Pro ở trang Gói Pro. */
export interface ProFeature { id: string; name: string; desc: string; tab: string; icon: string }

export const PRO_FEATURES: ProFeature[] = [
  { id: 'copy-ai', name: 'Đăng tín hiệu từ Phân tích AI', desc: 'Lấy lệnh agent đề xuất theo bộ quy tắc của bạn, chỉnh và đăng lên nhóm chỉ với một nút.', tab: 'share', icon: 'sparkle' },
  { id: 'copy-telegram', name: 'Chép tín hiệu từ kênh Telegram', desc: 'Chọn một tín hiệu từ các kênh bạn theo dõi, app điền sẵn cặp, chiều, giá vào, SL, TP.', tab: 'share', icon: 'send' },
  { id: 'ai', name: 'Phân tích AI', desc: 'Agent áp bộ quy tắc của bạn lên nến D1, H4, H1, M15 và đề xuất lệnh kèm khối lượng.', tab: 'ai', icon: 'sparkle' },
  { id: 'learn', name: 'Học kiến thức', desc: 'Dạy agent phương pháp riêng bằng PDF, phụ đề video, trò chuyện; xuất nhập bộ quy tắc.', tab: 'learn', icon: 'bulb' },
  { id: 'signals', name: 'Tín hiệu Telegram', desc: 'Gom lệnh từ nhiều kênh, chấm độ trùng khớp và thành tích từng kênh.', tab: 'signals', icon: 'send' },
]

/** Mặc định: hai tính năng đăng tín hiệu là Pro, còn lại miễn phí. */
export const DEFAULT_PRO_FEATURES = ['copy-ai', 'copy-telegram']

/** Tab nào đang bị khoá với người dùng hiện tại. */
export function lockedTabs(proFeatures: string[], isPro: boolean): Set<string> {
  if (isPro) return new Set()
  return new Set(PRO_FEATURES.filter((f) => proFeatures.includes(f.id) && f.tab !== 'share').map((f) => f.tab))
}
