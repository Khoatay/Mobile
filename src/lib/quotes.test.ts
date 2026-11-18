import { describe, expect, it } from 'vitest'
import { fromOf, neededQuotes, quoteKeyFor } from './quotes'
import { DEFAULT_SETTINGS } from './store'

const keys = (s: string, ccy = 'USD') => neededQuotes(s, ccy).map((q) => `${q.key}:${q.role}`)

describe('giá cần để quy đổi', () => {
  it('tìm ô giá theo đồng tiền', () => {
    expect(quoteKeyFor('EUR')).toBe('EURUSD')
    expect(quoteKeyFor('JPY')).toBe('USDJPY')
    expect(quoteKeyFor('XAU')).toBe('XAUUSD')
    expect(quoteKeyFor('USD')).toBeNull()
  })

  it('cặp kết thúc bằng USD chỉ cần giá cho ký quỹ', () => {
    expect(keys('XAUUSD')).toEqual(['XAUUSD:margin'])
    expect(keys('EURUSD')).toEqual(['EURUSD:margin'])
  })

  it('cặp có USD đứng trước cần giá để tính số lot', () => {
    expect(keys('USDJPY')).toEqual(['USDJPY:lot'])
  })

  it('cặp chéo cần giá đồng yết giá cho số lot, đồng cơ sở cho ký quỹ', () => {
    expect(keys('EURGBP')).toEqual(['GBPUSD:lot', 'EURUSD:margin'])
  })

  it('tài khoản EUR cần thêm giá EURUSD để đổi kết quả', () => {
    expect(keys('XAUUSD', 'EUR')).toEqual(['EURUSD:lot', 'XAUUSD:margin'])
    expect(keys('EURUSD', 'EUR')).toEqual(['EURUSD:lot'])
  })

  it('nguồn giá: chưa cập nhật lần nào là giá mẫu', () => {
    expect(fromOf(DEFAULT_SETTINGS, 'EURUSD')).toBe('sample')
    expect(fromOf({ ...DEFAULT_SETTINGS, quotesUpdatedAt: 1, quoteFrom: { EURUSD: 'mt5' } }, 'EURUSD')).toBe('mt5')
  })
})
