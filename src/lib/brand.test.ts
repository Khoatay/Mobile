import { describe, expect, it } from 'vitest'
import { BRAND_NAME, brandName } from './brand'
import { trackRecordHtml } from './trackrecord'

describe('thương hiệu Golden Duck', () => {
  it('tên trống hoặc tên cũ thì dùng Golden Duck, tên IB tự đặt thì giữ', () => {
    expect(brandName('')).toBe(BRAND_NAME)
    expect(brandName('FX Desk')).toBe(BRAND_NAME)
    expect(brandName(' Cộng đồng ABC ')).toBe('Cộng đồng ABC')
  })

  it('trang thành tích nhúng logo khi có', () => {
    const o = { title: 'T', subtitle: '', brand: 'Golden Duck', accent: '#2a78d6', hideMoney: true, currency: 'USD', ctaLabel: '', ctaUrl: '', disclaimer: true, recent: 5 }
    expect(trackRecordHtml([], { ...o, logo: 'data:image/svg+xml;base64,AAA' }, 'h')).toContain('<img src="data:image/svg+xml;base64,AAA"')
    expect(trackRecordHtml([], o, 'h')).not.toContain('<img')
  })
})
