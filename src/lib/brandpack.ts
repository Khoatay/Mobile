import { useEffect, useState } from 'react'
import type { Community, Product } from './catalog'
import { BRAND_URL, EDITION } from './edition'
import type { Offer } from './offers'
import { mergePartners, type PartnerConfig } from './partners'
import { usePersistent } from './store'

/**
 * Gói cấu hình của IB: thương hiệu, link đối tác, ưu đãi, cửa hàng, cộng đồng.
 * Bản IB chỉnh và xuất ra brand.json; bản trader đọc gói này và chỉ hiển thị.
 */
export interface BrandPack {
  version: 1
  brand: { brand: string; tagline: string; accent: string; link: string; disclaimer: boolean }
  partners: PartnerConfig[]
  offers: Offer[]
  products: Product[]
  communities: Community[]
  /** Mở các tính năng Pro cho mọi người dùng bản trader (ví dụ thời gian đầu, hoặc cộng đồng nội bộ). */
  proForAll: boolean
  /** Nơi người dùng bấm "Nâng cấp Pro": trang bán, nhóm Telegram, Zalo… */
  proUrl: string
  updatedAt: number
}

export const EMPTY_PACK: BrandPack = {
  version: 1,
  brand: { brand: 'FX Desk', tagline: '', accent: '#2a78d6', link: '', disclaimer: true },
  partners: mergePartners(undefined),
  offers: [], products: [], communities: [],
  proForAll: false, proUrl: '', updatedAt: 0,
}

/** Kiểm tra và chuẩn hoá một gói đọc từ file hoặc mạng; thiếu trường thì lấy mặc định. */
export function normalizePack(raw: unknown): BrandPack {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BrandPack>
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    ...EMPTY_PACK,
    ...r,
    version: 1,
    brand: { ...EMPTY_PACK.brand, ...(r.brand ?? {}) },
    partners: mergePartners(arr<PartnerConfig>(r.partners)),
    offers: arr(r.offers), products: arr(r.products), communities: arr(r.communities),
    proForAll: !!r.proForAll, proUrl: typeof r.proUrl === 'string' ? r.proUrl : '',
  }
}

/** Lần đầu: lấy link đối tác và ưu đãi đã lưu ở bản cũ (Cá nhân hoá, trang Ưu đãi) sang gói mới. */
function migrate(): BrandPack {
  try {
    const prof = JSON.parse(localStorage.getItem('fx.profile') || '{}')
    const offers = JSON.parse(localStorage.getItem('fx.offers') || '[]')
    const old = (prof.partners ?? {}) as Record<string, { url?: string; code?: string }>
    const partners = mergePartners(undefined).map((p) => ({ ...p, url: old[p.id]?.url ?? '', code: old[p.id]?.code ?? '' }))
    return { ...EMPTY_PACK, partners, offers: Array.isArray(offers) ? offers : [] }
  } catch {
    return EMPTY_PACK
  }
}

export interface PackState {
  pack: BrandPack
  /** Chỉ có ở bản IB. */
  setPack: ((p: BrandPack) => void) | null
  loading: boolean
  error: string
}

export function useBrandPack(): PackState {
  const [saved, setSaved] = usePersistent<BrandPack | null>('fx.brandpack', EDITION === 'owner' ? null : null)
  const [remote, setRemote] = useState<{ pack: BrandPack; loading: boolean; error: string }>({ pack: EMPTY_PACK, loading: EDITION === 'trader', error: '' })

  useEffect(() => {
    if (EDITION === 'owner' && saved == null) setSaved(migrate())
  }, [saved])

  useEffect(() => {
    if (EDITION !== 'trader') return
    fetch(BRAND_URL, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((j) => setRemote({ pack: normalizePack(j), loading: false, error: '' }))
      .catch(() => setRemote({ pack: EMPTY_PACK, loading: false, error: 'Không tải được cấu hình của cộng đồng.' }))
  }, [])

  if (EDITION === 'trader') return { ...remote, setPack: null }
  const pack = normalizePack(saved ?? EMPTY_PACK)
  return { pack, setPack: (p) => setSaved({ ...p, updatedAt: Date.now() }), loading: false, error: '' }
}
