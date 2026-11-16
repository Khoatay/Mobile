/**
 * Hai bản của app:
 * - "owner" (bản IB, trả phí): cấu hình link giới thiệu, ưu đãi, cửa hàng, cộng đồng; xuất gói cấu hình.
 * - "trader" (bản phát cho người dùng): chỉ xem những gì IB đã cấu hình. Build bằng VITE_EDITION=trader.
 * Bản IB có công tắc "Xem như người dùng" để kiểm tra giao diện của trader.
 */
export const EDITION: 'owner' | 'trader' = import.meta.env.VITE_EDITION === 'trader' ? 'trader' : 'owner'

/** Nơi bản trader tải gói cấu hình. Mặc định là file brand.json đóng gói cùng app. */
export const BRAND_URL: string = import.meta.env.VITE_BRAND_URL || './brand.json'
