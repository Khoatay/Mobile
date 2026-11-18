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

describe('website riêng', () => {
  it('gọn tên miền để hiện, thêm https:// để mở', async () => {
    const { siteName, siteUrl } = await import('./brand')
    expect(siteName('https://www.goldenduck.vn/')).toBe('goldenduck.vn')
    expect(siteName('goldenduck.vn')).toBe('goldenduck.vn')
    expect(siteUrl('goldenduck.vn')).toBe('https://goldenduck.vn')
    expect(siteUrl('http://a.b')).toBe('http://a.b')
    expect(siteUrl('')).toBe('')
  })

  it('bài đăng và trang thành tích có website khi đã điền', async () => {
    const { footer, DEFAULT_PROFILE } = await import('./share')
    expect(footer({ ...DEFAULT_PROFILE, website: 'https://goldenduck.vn' })).toContain('🌐 goldenduck.vn')
    expect(footer(DEFAULT_PROFILE)).not.toContain('🌐')
    const o = { title: 'T', subtitle: '', brand: 'Golden Duck', accent: '#2a78d6', hideMoney: true, currency: 'USD', ctaLabel: '', ctaUrl: '', disclaimer: true, recent: 5 }
    expect(trackRecordHtml([], { ...o, website: 'https://goldenduck.vn' }, 'h')).toContain('🌐 goldenduck.vn')
  })
})
