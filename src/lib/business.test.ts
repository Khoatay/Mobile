import { describe, expect, it } from 'vitest'
import type { Mt5Deal } from './bridge'
import { balanceDealsToEntries, summarize, type LedgerEntry } from './ledger'
import { currenciesOf, filterEvents, imminent, type CalEvent } from './news'
import { DEFAULT_PROFILE, DISCLAIMER, periodTrades, pipsOf, resultPost, signalPost, statsPost } from './share'
import type { Trade } from './types'

const e = (date: string, flow: 'in' | 'out', category: string, amount: number): LedgerEntry => ({ id: date + category + amount, date, flow, category, amount })

describe('ledger', () => {
  const entries = [e('2026-01-05', 'out', 'prop_fee', 540), e('2026-01-10', 'out', 'deposit', 1000), e('2026-01-20', 'out', 'tools', 60), e('2026-02-15', 'in', 'prop_payout', 1800), e('2026-02-20', 'in', 'backcom', 120), e('2026-03-01', 'out', 'prop_fee', 540)]
  it('tổng, ROI và tiền còn trong tài khoản', () => {
    const s = summarize(entries, 900)
    expect(s.out).toBe(2140)
    expect(s.in).toBe(1920)
    expect(s.net).toBe(-220)
    expect(s.total).toBe(680)
    expect(s.roi).toBeCloseTo(680 / 2140)
    expect(summarize([]).roi).toBeNull()
  })
  it('theo danh mục và theo tháng có luỹ kế', () => {
    const s = summarize(entries)
    expect(s.byCategory[0]).toMatchObject({ id: 'prop_fee', amount: 1080, n: 2, flow: 'out' })
    expect(s.byCategory.map((c) => c.flow)).toEqual(['out', 'out', 'out', 'in', 'in'])
    expect(s.byMonth).toEqual([
      { month: '2026-01', in: 0, out: 1600, net: -1600, cum: -1600 },
      { month: '2026-02', in: 1920, out: 0, net: 1920, cum: 320 },
      { month: '2026-03', in: 0, out: 540, net: -540, cum: -220 },
    ])
  })
  it('nạp/rút từ deal MT5', () => {
    const d = (ticket: number, type: number, profit: number): Mt5Deal => ({ ticket, positionId: 0, time: Date.UTC(2026, 0, 10) / 1000, type, entry: 0, symbol: '', volume: 0, price: 0, commission: 0, fee: 0, swap: 0, profit })
    const out = balanceDealsToEntries([d(1, 2, 1000), d(2, 2, -300), d(3, 0, 50), d(4, 2, 0)], '555', 'Thật')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 'mt5:555:1', flow: 'out', category: 'deposit', amount: 1000, date: '2026-01-10', account: '555' })
    expect(out[1]).toMatchObject({ flow: 'in', category: 'withdraw', amount: 300 })
  })
})

const t = (p: Partial<Trade>): Trade => ({ id: 'x', ticket: '1', symbol: 'EURUSD', side: 'buy', volume: 0.1, openTime: Date.UTC(2026, 10, 12, 9), closeTime: Date.UTC(2026, 10, 12, 12), openPrice: 1.08, closePrice: 1.084, sl: 1.078, tp: 0, commission: -1, swap: 0, profit: 40, source: 'manual', ...p })

describe('share', () => {
  it('pip theo chiều lệnh và loại cặp', () => {
    expect(pipsOf(t({}))).toBeCloseTo(40)
    expect(pipsOf(t({ side: 'sell' }))).toBeCloseTo(-40)
    expect(pipsOf(t({ symbol: 'XAUUSD', openPrice: 2600, closePrice: 2605 }))).toBeCloseTo(50)
    expect(pipsOf(t({ symbol: 'US30' }))).toBeNull()
  })
  it('bài đăng tín hiệu', () => {
    const p = signalPost({ symbol: 'XAUUSD', side: 'sell', entry: 2600, sl: 2610, tps: [2585, 2570], note: 'Chờ phản ứng tại vùng cung.' }, { ...DEFAULT_PROFILE, brand: 'Nhóm A', link: 'https://vi.du/ib' })
    expect(p.spec).toMatchObject({ title: 'XAUUSD', big: 'SELL', tone: 'neg' })
    expect(p.spec.rows).toContainEqual(['R:R', '1:1.5'])
    expect(p.caption).toContain('TP2: 2570')
    expect(p.caption).toContain('Chờ phản ứng')
    expect(p.caption).toContain(DISCLAIMER)
    expect(p.caption.trim().endsWith('— Nhóm A')).toBe(true)
  })
  it('bài đăng kết quả: ẩn tiền theo cài đặt', () => {
    const hidden = resultPost(t({}), 'USD', DEFAULT_PROFILE)
    expect(hidden.spec).toMatchObject({ big: '+40.0 pip', tone: 'pos', kicker: 'Lệnh chốt lời' })
    expect(hidden.caption).toContain('+2.00R')
    expect(hidden.caption).not.toContain('Lãi/lỗ ròng')
    const shown = resultPost(t({ profit: -30, closePrice: 1.078 }), 'USD', { ...DEFAULT_PROFILE, hideMoney: false, disclaimer: false })
    expect(shown.spec.tone).toBe('neg')
    expect(shown.caption).toContain('−31.00 USD')
    expect(shown.caption).not.toContain(DISCLAIMER)
  })
  it('lọc theo kỳ và bài thống kê', () => {
    const now = Date.UTC(2026, 10, 15, 10) // Chủ nhật 15/11/2026
    const list = [t({ closeTime: Date.UTC(2026, 10, 15, 8) }), t({ closeTime: Date.UTC(2026, 10, 9, 8), profit: -20, closePrice: 1.079 }), t({ closeTime: Date.UTC(2026, 10, 2, 8) }), t({ closeTime: Date.UTC(2026, 9, 20, 8) }), t({ closeTime: Date.UTC(2026, 8, 1, 8) })]
    expect(periodTrades(list, 'today', now)).toHaveLength(1)
    expect(periodTrades(list, 'week', now)).toHaveLength(2)
    expect(periodTrades(list, 'month', now)).toHaveLength(3)
    expect(periodTrades(list, 'last30', now)).toHaveLength(4)
    const p = statsPost(periodTrades(list, 'month', now), 'Tháng này', 'USD', DEFAULT_PROFILE)
    expect(p.spec).toMatchObject({ title: '3 lệnh', big: '+70 pip', tone: 'pos' })
    expect(p.caption).toContain('Tỷ lệ thắng: 67% (2 thắng, 1 thua)')
  })
})

describe('news', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')
  const ev = (title: string, currency: string, date: string, impact: string): CalEvent => ({ title, currency, date, impact, forecast: '', previous: '' })
  const events = [ev('CPI', 'USD', '2026-11-16T07:30:00-05:00', 'High'), ev('PMI', 'EUR', '2026-11-16T13:00:00Z', 'Medium'), ev('Rate', 'JPY', '2026-11-16T12:20:00Z', 'High'), ev('Old', 'USD', '2026-11-16T09:00:00Z', 'High'), ev('Bad', 'USD', '', 'High')]
  it('đồng tiền đang giữ', () => {
    expect(currenciesOf(['EURUSD.m', 'XAUUSD', 'US30'])).toEqual(['EUR', 'USD'])
  })
  it('tin sắp ra ảnh hưởng lệnh đang mở', () => {
    expect(imminent(events, ['EUR', 'USD'], now).map((x) => x.title)).toEqual(['CPI'])
    expect(imminent(events, ['JPY'], now, 10)).toEqual([])
  })
  it('lọc theo mức độ và đồng tiền, sắp theo giờ, bỏ ngày hỏng', () => {
    expect(filterEvents(events, 3, null).map((x) => x.title)).toEqual(['Old', 'Rate', 'CPI'])
    expect(filterEvents(events, 2, ['EUR']).map((x) => x.title)).toEqual(['PMI'])
  })
})

import { bridgeType, currenciesIn, defaultInfo, groupsOf, inScope, resolveInfos, scopeLabel } from './accounts'

describe('accounts', () => {
  const metas = [
    { id: '1', label: 'Exness', type: 'real' as const, tradable: false, connected: true, error: '' },
    { id: '2', label: 'FTMO', type: 'prop' as const, tradable: false, connected: false, error: '' },
  ]
  const live = [{ ...metas[0], login: 1, server: 's', name: '', currency: 'USD', balance: 1, equity: 1, profit: 0, margin: 0, marginFree: 1, leverage: 100, positions: [] }]
  const infos = resolveInfos(['3'], { '1': { group: 'Real', broker: 'Exness' }, '2': { group: 'Quỹ A', phase: 'Vòng 1', currency: 'USD' }, '3': { group: 'Quỹ A', label: '', currency: 'EUR' } }, metas, live)
  it('gộp mặc định từ bridge với nhãn người dùng', () => {
    expect(infos['1']).toMatchObject({ label: 'Exness', broker: 'Exness', env: 'real', role: 'own', group: 'Real', currency: 'USD' })
    expect(infos['2']).toMatchObject({ role: 'prop', phase: 'Vòng 1' })
    expect(infos['3'].label).toBe('3')
    expect(defaultInfo('9', { label: 'D', type: 'demo' })).toMatchObject({ env: 'demo', role: 'own' })
    expect(bridgeType({ env: 'real', role: 'prop' })).toBe('prop')
    expect(bridgeType({ env: 'demo', role: 'prop' })).toBe('demo')
  })
  it('phạm vi theo nhóm và tài khoản', () => {
    expect(groupsOf(infos)).toEqual(['Quỹ A', 'Real'])
    expect(inScope('', undefined, infos)).toBe(true)
    expect(inScope('g:Quỹ A', '2', infos)).toBe(true)
    expect(inScope('g:Quỹ A', '1', infos)).toBe(false)
    expect(inScope('g:Quỹ A', undefined, infos)).toBe(false)
    expect(inScope('a:1', '1', infos)).toBe(true)
    expect(scopeLabel('g:Real', infos)).toBe('Nhóm Real')
    expect(scopeLabel('a:2', infos)).toBe('FTMO')
    expect(currenciesIn('g:Quỹ A', infos)).toEqual(['USD', 'EUR'])
  })
})

import { blankOffer, daysLeft, offerCaption, offerUrl, sortOffers } from './offers'

describe('offers', () => {
  const now = Date.parse('2026-11-16T10:00:00')
  const o = (p: Partial<ReturnType<typeof blankOffer>>) => ({ ...blankOffer(), ...p })
  it('hạn dùng và thứ tự', () => {
    expect(daysLeft(o({ expires: '2026-11-16' }), now)).toBe(0)
    expect(daysLeft(o({ expires: '2026-11-20' }), now)).toBe(4)
    expect(daysLeft(o({ expires: '2026-11-10' }), now)).toBeLessThan(0)
    expect(daysLeft(o({}), now)).toBeNull()
    const list = [o({ id: 'a', createdAt: 3 }), o({ id: 'b', expires: '2026-11-30' }), o({ id: 'c', expires: '2026-11-18' }), o({ id: 'd', pinned: true, createdAt: 1 })]
    expect(sortOffers(list, now).map((x) => x.id)).toEqual(['d', 'c', 'b', 'a'])
  })
  it('link mặc định và nội dung đăng', () => {
    const links = { ftmo: { url: 'https://vi.du/ftmo', code: 'X' } }
    const x = o({ partner: 'ftmo', title: 'Giảm 20%', code: 'TRADER20', expires: '2099-01-31' })
    expect(offerUrl(x, links)).toBe('https://vi.du/ftmo')
    expect(offerUrl({ ...x, url: 'https://khac' }, links)).toBe('https://khac')
    const c = offerCaption(x, links, true)
    expect(c).toContain('FTMO: Giảm 20%')
    expect(c).toContain('Mã: TRADER20')
    expect(c).toContain('Hạn: 31/01/2099')
    expect(c).toContain('👉 https://vi.du/ftmo')
  })
})

import { jsonToText } from '../pages/Learn'

describe('nhập file AI khác', () => {
  it('lấy chữ từ JSON lịch sử chat, bỏ id và ngày giờ', () => {
    const raw = JSON.stringify([{ id: 'a1b2c3d4e5f6g7h8i9j0k1', create_time: '2026-11-01T10:00:00Z', mapping: { x: { message: { content: { parts: ['Order block là nến ngược chiều cuối cùng trước cú phá cấu trúc.', 'ok'] } } } } }, { title: 'Ghi chú ICT về thanh khoản phiên Á' }])
    const t = jsonToText(raw)
    expect(t).toContain('Order block là nến ngược chiều')
    expect(t).toContain('Ghi chú ICT về thanh khoản phiên Á')
    expect(t).not.toContain('2026-11-01')
    expect(t).not.toContain('a1b2c3')
    expect(t).not.toContain('ok')
  })
})

import { normalizePack } from './brandpack'
import { mergePartners, partnerFor, partnerLinks } from './partners'
import { telegramUrl } from './catalog'

describe('gói cấu hình', () => {
  it('chuẩn hoá gói thiếu trường và gộp đối tác', () => {
    const p = normalizePack({ brand: { brand: 'Alpha' }, partners: [{ id: 'ftmo', url: 'https://a', visible: true, name: 'X', kind: 'tool' }, { id: 'fn', name: 'FundedNext', kind: 'prop', url: 'https://fn', code: '', cta: '', pitch: '', visible: true, custom: true }], offers: 'sai' })
    expect(p.brand).toMatchObject({ brand: 'Alpha', accent: '#2a78d6', disclaimer: true })
    expect(p.offers).toEqual([])
    const ftmo = p.partners.find((x) => x.id === 'ftmo')!
    expect(ftmo).toMatchObject({ url: 'https://a', name: 'FTMO', kind: 'prop' })
    expect(p.partners[p.partners.length - 1].id).toBe('fn')
    expect(partnerFor('FundedNext 50K', p.partners)?.id).toBe('fn')
    expect(normalizePack(null).partners).toHaveLength(6)
  })
  it('chỉ lấy link đang bật', () => {
    const list = mergePartners([{ id: 'exness', name: '', kind: 'broker', url: 'https://ex', code: 'A', cta: 'Mở tài khoản', pitch: '', visible: true }, { id: 'ftmo', name: '', kind: 'prop', url: 'https://f', code: '', cta: '', pitch: '', visible: false }])
    expect(Object.keys(partnerLinks(list))).toEqual(['exness'])
    expect(partnerLinks(list).exness).toMatchObject({ url: 'https://ex', code: 'A', cta: 'Mở tài khoản', name: 'Exness' })
  })
  it('link Telegram', () => {
    expect(telegramUrl('@fxdesk_free')).toBe('https://t.me/fxdesk_free')
    expect(telegramUrl('t.me/+abcDEF')).toBe('https://t.me/+abcDEF')
    expect(telegramUrl('https://t.me/x')).toBe('https://t.me/x')
  })
})

import { lockedTabs } from './pro'

describe('Pro', () => {
  it('khoá trang theo tính năng, trừ trang Chia sẻ (khoá từng lựa chọn bên trong)', () => {
    expect([...lockedTabs(['copy-ai', 'ai', 'signals'], false)].sort()).toEqual(['ai', 'signals'])
    expect(lockedTabs(['ai'], true).size).toBe(0)
    expect(normalizePack({}).proFeatures).toEqual(['copier', 'copy-ai'])
    expect(normalizePack({ proFeatures: ['ai', 3] }).proFeatures).toEqual(['ai'])
  })
})

import { buildGuard, copyVolume, dayRefOfPreset, DEFAULT_GUARD_UI, guardChanged } from './automation'

describe('bảo vệ và copy lệnh', () => {
  it('giới hạn theo luật quỹ hoặc % số dư', () => {
    const g = buildGuard(DEFAULT_GUARD_UI, 2, 100000, { dailyLimit: 5000, floor: 90000, maxLossLimit: 10000 })
    expect(g).toMatchObject({ daily_limit: 5000, floor: 90000, max_loss: 10000, act_at: 0.95, warn_at: [0.7, 0.9], max_consec_losses: 3, server_offset: 2 })
    const c = buildGuard({ ...DEFAULT_GUARD_UI, source: 'custom', dailyPct: 2, totalPct: 6, warn2: 96 }, 3, 20000)
    expect(c).toMatchObject({ daily_limit: 400, floor: 18800, max_loss: 1200, warn_at: [0.7] })
    expect(g).toMatchObject({ hard_stop: true, hard_lock: true, day_ref: 'balance' })
    expect(buildGuard(DEFAULT_GUARD_UI, 2, 100000, { dailyLimit: 5000, floor: 90000, maxLossLimit: 10000, dayRef: dayRefOfPreset('5ers-hs-1') }).day_ref).toBe('higher')
    expect(dayRefOfPreset('ftmo-2s-1')).toBe('balance')
    // cài đặt cũ lưu trước khi có tuỳ chọn mới vẫn bật SL khẩn cấp và khoá cứng
    const old = { ...DEFAULT_GUARD_UI } as Partial<typeof DEFAULT_GUARD_UI>; delete old.hardStop; delete old.hardLock
    expect(buildGuard(old as typeof DEFAULT_GUARD_UI, 2, 1000)).toMatchObject({ hard_stop: true, hard_lock: true })
    expect(guardChanged(g, { ...g })).toBe(false)
    expect(guardChanged(g, { ...g, daily_limit: 4999.5 })).toBe(true)
    expect(guardChanged(undefined, g)).toBe(true)
  })
  it('khối lượng chép', () => {
    expect(copyVolume(1, 10000, 50000, { account: 'x', mode: 'balance', value: 1, reverse: false })).toBe(5)
    expect(copyVolume(1, 10000, 50000, { account: 'x', mode: 'multiplier', value: 0.5, reverse: false })).toBe(0.5)
    expect(copyVolume(2, 10000, 50000, { account: 'x', mode: 'fixed', value: 0.1, reverse: false })).toBe(0.1)
  })
})
