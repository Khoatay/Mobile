import { groupsOf, type InfoMap, type Scope } from '../lib/accounts'

/** Chọn phạm vi: tất cả, một nhóm, hoặc một tài khoản. Chỉ liệt kê tài khoản có trong `ids`. */
export default function ScopeSelect({ value, onChange, infos, ids }: { value: Scope; onChange: (s: Scope) => void; infos: InfoMap; ids: string[] }) {
  const groups = groupsOf(Object.fromEntries(ids.filter((id) => infos[id]).map((id) => [id, infos[id]])))
  if (!ids.length) return null
  return (
    <select aria-label="Phạm vi tài khoản" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto' }}>
      <option value="">Tất cả tài khoản</option>
      {groups.length > 0 && (
        <optgroup label="Theo nhóm">
          {groups.map((g) => <option key={g} value={`g:${g}`}>Nhóm {g}</option>)}
        </optgroup>
      )}
      <optgroup label="Từng tài khoản">
        {ids.map((id) => <option key={id} value={`a:${id}`}>{infos[id]?.label ?? id}{infos[id]?.group ? ` · ${infos[id].group}` : ''}</option>)}
      </optgroup>
    </select>
  )
}
