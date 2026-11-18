import { describe, expect, it } from 'vitest'
import { serverOptions } from './servers'

describe('gợi ý máy chủ MT5', () => {
  it('máy chủ đã dùng trên máy lên đầu, không trùng; sàn đã chọn được ưu tiên', () => {
    const o = serverOptions(['Exness-MT5Real8', 'FTMO-Demo'], 'IC Markets')
    expect(o.slice(0, 2).map((x) => x.name)).toEqual(['Exness-MT5Real8', 'FTMO-Demo'])
    expect(o[2].name).toBe('ICMarketsSC-MT5')
    expect(o.filter((x) => x.name === 'Exness-MT5Real8')).toHaveLength(1)
    expect(o.some((x) => x.name === 'Exness-MT5Trial15')).toBe(true)
  })
})
