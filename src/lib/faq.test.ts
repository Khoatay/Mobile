import { describe, expect, it } from 'vitest'
import { cannedAnswer, fold } from './faq'

describe('câu trả lời soạn sẵn', () => {
  it('bỏ dấu', () => expect(fold('Cắt lỗ là gì?')).toBe(' cat lo la gi '))
  it('khớp câu hỏi cơ bản', () => {
    expect(cannedAnswer('Pip là gì?')).toMatch(/10 pip = 1 giá/)
    const both = cannedAnswer('Pip và lot là gì?')!
    expect(both).toMatch(/Pip/)
    expect(both).toMatch(/Lot/)
    expect(cannedAnswer('Stop loss nên đặt thế nào?')).toMatch(/Tính lệnh/)
    expect(cannedAnswer('Thua 2 lệnh liền rồi, giờ làm gì?')).toMatch(/nghỉ/)
  })
  it('để AI trả lời câu hỏi riêng', () => {
    expect(cannedAnswer('Vốn 100 đô thì nên vào bao nhiêu lot?')).toBeNull()
    expect(cannedAnswer('Hôm nay vàng có nên mua không?')).toBeNull()
    expect(cannedAnswer('Mình trade dạo này thế nào?')).toBeNull()
    expect(cannedAnswer('Giải thích giúp mình chiến lược breakout kết hợp stop loss theo ATR cho khung H1')).toBeNull()
    expect(cannedAnswer('sloppy')).toBeNull()
  })
})
