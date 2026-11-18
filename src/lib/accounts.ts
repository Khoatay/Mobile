import type { AccountMeta, AccountType, LiveAccount } from './bridge'

/** 'view': tài khoản của người khác, theo dõi bằng mật khẩu view (investor) họ chia sẻ. */
export type Role = 'own' | 'prop' | 'copy' | 'view'
export type Env = 'real' | 'demo'

/** Nhãn người dùng gắn cho một tài khoản. Lưu trong trình duyệt, theo số tài khoản. */
export interface AccountInfo {
  label: string
  broker: string
  env: Env
  role: Role
  /** Giai đoạn với tài khoản quỹ: Vòng 1, Vòng 2, Đã cấp vốn… */
  phase: string
  /** Nhóm để gộp thống kê, ví dụ "Real", "Quỹ A". Rỗng = chưa phân nhóm. */
  group: string
  note: string
  /** Tiền tệ tài khoản, ghi lại từ MT5 lần gần nhất đọc được. */
  currency?: string
}

export const ROLE_TEXT: Record<Role, string> = { own: 'Tài khoản riêng', prop: 'Quỹ', copy: 'Copy trade (nguồn)', view: 'Only view (người khác)' }

/** Bốn nhóm ở trang Tài khoản. Real gồm cả tài khoản demo của bạn ở mọi broker. */
export type Category = 'real' | 'prop' | 'copy' | 'view'
export const CATEGORIES: { id: Category; label: string; role: Role; blurb: string }[] = [
  { id: 'real', label: 'Real', role: 'own', blurb: 'Tài khoản của bạn ở các broker, cả real và demo.' },
  { id: 'prop', label: 'Quỹ', role: 'prop', blurb: 'Tài khoản thi quỹ và tài khoản đã được cấp vốn.' },
  { id: 'copy', label: 'Copy trade', role: 'copy', blurb: 'Tài khoản dùng để chép lệnh.' },
  { id: 'view', label: 'Only view', role: 'view', blurb: 'Tài khoản của người khác, theo dõi trực tiếp bằng mật khẩu view họ chia sẻ. Không tính vào tiền, thống kê hay nhật ký của bạn.' },
]
export const categoryOf = (info: Pick<AccountInfo, 'role'> | undefined): Category =>
  info?.role === 'prop' ? 'prop' : info?.role === 'copy' ? 'copy' : info?.role === 'view' ? 'view' : 'real'
/** Tài khoản Only view không phải của bạn: không cộng vào số dư, thống kê, bảo vệ hay nhật ký. */
export const isView = (info: Pick<AccountInfo, 'role'> | undefined) => info?.role === 'view'
export const PHASES = ['Vòng 1', 'Vòng 2', 'Vòng 3', 'Đã cấp vốn', 'Instant funding']
export const BROKERS = ['Exness', 'FTMO', 'The5ers', 'TenTrade', 'IC Markets', 'XM', 'Pepperstone', 'FundedNext']
export const GROUP_SUGGESTIONS = ['Real', 'Demo', 'Quỹ FTMO', 'Quỹ The5ers', 'Quỹ TenTrade', 'Copy trade']

/** Suy ra nhãn ban đầu từ loại tài khoản khai báo trong bridge. */
export function defaultInfo(id: string, meta?: Pick<AccountMeta, 'label' | 'type'>): AccountInfo {
  const t: AccountType = meta?.type ?? 'real'
  return {
    label: meta?.label || id,
    broker: '',
    env: t === 'demo' ? 'demo' : 'real',
    role: t === 'prop' ? 'prop' : t === 'copy' ? 'copy' : t === 'view' ? 'view' : 'own',
    phase: '',
    group: '',
    note: '',
  }
}

/** Ngược lại: loại tài khoản gửi cho bridge khi thêm từ app. */
export function bridgeType(info: Pick<AccountInfo, 'env' | 'role'>): AccountType {
  if (info.role === 'view') return 'view'
  if (info.env === 'demo') return 'demo'
  return info.role === 'prop' ? 'prop' : info.role === 'copy' ? 'copy' : 'real'
}

export type InfoMap = Record<string, AccountInfo>

/** Mọi tài khoản đã biết (từ bridge và từ Nhật ký), kèm nhãn đã gộp mặc định với phần người dùng đã sửa. */
export function resolveInfos(ids: string[], stored: Record<string, Partial<AccountInfo>>, metas: AccountMeta[], live: LiveAccount[]): InfoMap {
  const out: InfoMap = {}
  const all = [...new Set([...metas.map((m) => m.id), ...ids])]
  for (const id of all) {
    const base = defaultInfo(id, metas.find((m) => m.id === id))
    const mine = stored[id] ?? {}
    out[id] = { ...base, ...mine, label: mine.label || base.label, currency: live.find((a) => a.id === id)?.currency ?? mine.currency }
  }
  return out
}

export function badges(info: AccountInfo): string[] {
  return [info.broker, info.env === 'demo' ? 'Demo' : 'Real', info.role !== 'own' ? ROLE_TEXT[info.role] : '', info.phase].filter(Boolean)
}

export function groupsOf(infos: InfoMap): string[] {
  return [...new Set(Object.values(infos).map((i) => i.group.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'))
}

/** Phạm vi xem: "" tất cả, "g:<nhóm>" một nhóm, "a:<số tài khoản>" một tài khoản. */
export type Scope = string

export function inScope(scope: Scope, account: string | undefined, infos: InfoMap): boolean {
  if (!scope) return true
  if (scope.startsWith('a:')) return account === scope.slice(2)
  if (scope.startsWith('g:')) return !!account && infos[account]?.group.trim() === scope.slice(2)
  return true
}

export function scopeLabel(scope: Scope, infos: InfoMap): string {
  if (!scope) return 'Tất cả tài khoản'
  if (scope.startsWith('g:')) return `Nhóm ${scope.slice(2)}`
  return infos[scope.slice(2)]?.label ?? scope.slice(2)
}

/** Các tài khoản trong phạm vi; dùng để cảnh báo khi gộp tài khoản khác tiền tệ. */
export function currenciesIn(scope: Scope, infos: InfoMap): string[] {
  const ids = Object.keys(infos).filter((id) => inScope(scope, id, infos))
  return [...new Set(ids.map((id) => infos[id].currency).filter((c): c is string => !!c))]
}
