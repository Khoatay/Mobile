/** Danh sách tính năng có thể đặt là Pro. IB chọn tính năng nào là Pro ở trang Gói Pro. */
export interface ProFeature { id: string; name: string; desc: string; tab: string; icon: string }

export const PRO_FEATURES: ProFeature[] = [
  { id: 'guard', name: 'Bảo vệ tài khoản', desc: 'Cảnh báo về điện thoại, tự đóng lệnh và khoá vào lệnh khi sắp chạm giới hạn lỗ của quỹ, sau chuỗi thua hoặc khi vào quá nhiều lệnh.', tab: 'guard', icon: 'lock' },
  { id: 'copier', name: 'Copy lệnh nhiều tài khoản', desc: 'Vào lệnh một lần, bridge chép sang các tài khoản còn lại: mở, đóng, SL/TP, lot theo hệ số hoặc theo số dư.', tab: 'copier', icon: 'copy' },
  { id: 'copy-ai', name: 'Đăng tín hiệu từ AI phân tích', desc: 'Lấy lệnh agent đề xuất theo bộ quy tắc của bạn, chỉnh và đăng lên nhóm chỉ với một nút.', tab: 'share', icon: 'sparkle' },
  { id: 'copy-telegram', name: 'Chép tín hiệu từ kênh Telegram', desc: 'Chọn một tín hiệu từ các kênh bạn theo dõi, app điền sẵn cặp, chiều, giá vào, SL, TP.', tab: 'share', icon: 'send' },
  { id: 'ai', name: 'AI phân tích', desc: 'Agent áp bộ quy tắc của bạn lên nến D1, H4, H1, M15 và đề xuất lệnh kèm khối lượng.', tab: 'ai', icon: 'sparkle' },
  { id: 'learn', name: 'AI học trade', desc: 'Dạy agent phương pháp riêng bằng PDF, phụ đề video, trò chuyện; xuất nhập bộ quy tắc.', tab: 'learn', icon: 'bulb' },
  { id: 'signals', name: 'Tín hiệu Telegram', desc: 'Gom lệnh từ nhiều kênh, chấm độ trùng khớp và thành tích từng kênh.', tab: 'signals', icon: 'send' },
]

/** Mặc định: bảo vệ tài khoản, copy lệnh và đăng tín hiệu từ AI là Pro, còn lại miễn phí. */
export const DEFAULT_PRO_FEATURES = ['copier', 'copy-ai']

/** Tab nào đang bị khoá với người dùng hiện tại. */
export function lockedTabs(proFeatures: string[], isPro: boolean): Set<string> {
  if (isPro) return new Set()
  return new Set(PRO_FEATURES.filter((f) => proFeatures.includes(f.id) && f.tab !== 'share').map((f) => f.tab))
}
