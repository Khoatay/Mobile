import { Field } from './Field'
import type { InfoMap } from '../lib/accounts'
import { WEEKDAY_NAMES } from '../lib/autopost'
import type { AutopostApi } from '../lib/useAutopost'

const KIND_TEXT = { morning: 'Lịch tin buổi sáng', result: 'Kết quả lệnh', weekly: 'Thống kê tuần' }
const STATUS_TEXT = { pending: 'Chờ duyệt', sent: 'Đã gửi', skipped: 'Bỏ qua', error: 'Lỗi' }

export default function AutopostPanel({ api, targets, accountIds, infos }: { api: AutopostApi; targets: string[]; accountIds: string[]; infos: InfoMap }) {
  const { cfg, setCfg, state } = api
  const set = (p: Partial<typeof cfg>) => setCfg({ ...cfg, ...p })
  const pending = state.queue.filter((q) => q.status === 'pending')
  return (
    <>
      <section className="card form">
        <h3>Đăng tự động lên nhóm</h3>
        {targets.length === 0 ? <p className="warn">⚠ Chưa có nhóm nào để gửi. Thêm tên nhóm vào <code>post_targets</code> trong <code>bridge/config.json</code> rồi chạy lại bridge.</p> : (
          <div className="row">
            <Field label="Nhóm nhận"><select value={cfg.target} onChange={(e) => set({ target: e.target.value })}><option value="">Chọn nhóm…</option>{targets.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field group label="Cách đăng">
              <div className="seg">
                <button className={cfg.mode === 'approve' ? 'active' : ''} aria-pressed={cfg.mode === 'approve'} onClick={() => set({ mode: 'approve' })}>Duyệt trước khi đăng</button>
                <button className={cfg.mode === 'auto' ? 'active' : ''} aria-pressed={cfg.mode === 'auto'} onClick={() => set({ mode: 'auto' })}>Đăng ngay</button>
              </div>
            </Field>
          </div>
        )}

        <div className="auto-jobs">
          <div className={`auto-job${cfg.morning.on ? ' on' : ''}`}>
            <label className="switch"><input type="checkbox" checked={cfg.morning.on} onChange={(e) => set({ morning: { ...cfg.morning, on: e.target.checked } })} /><span>Lịch tin buổi sáng</span></label>
            <p className="muted small">Các tin mạnh trong ngày, giờ ra tin và đồng tiền cần cẩn thận.</p>
            <div className="row">
              <Field label="Giờ đăng"><input type="time" value={cfg.morning.time} onChange={(e) => set({ morning: { ...cfg.morning, time: e.target.value } })} /></Field>
              <label className="inline wrap" style={{ alignSelf: 'end' }}><input type="checkbox" className="check" checked={cfg.morning.withMedium} onChange={(e) => set({ morning: { ...cfg.morning, withMedium: e.target.checked } })} /> Cả tin mức vừa</label>
            </div>
            <button className="ghost mini" disabled={!cfg.target} onClick={() => api.runNow('morning')}>Tạo bài ngay</button>
          </div>
          <div className={`auto-job${cfg.results.on ? ' on' : ''}`}>
            <label className="switch"><input type="checkbox" checked={cfg.results.on} disabled={!cfg.results.accounts.length} onChange={(e) => set({ results: { ...cfg.results, on: e.target.checked } })} /><span>Kết quả lệnh vừa đóng</span></label>
            <p className="muted small">Mỗi lệnh đóng trên các tài khoản chọn dưới đây thành một bài kèm ảnh. Chỉ đăng lệnh đóng sau khi bật.</p>
            <div className="chips">
              {accountIds.map((id) => {
                const on = cfg.results.accounts.includes(id)
                return <button key={id} className={on ? 'chip-toggle on' : 'chip-toggle'} aria-pressed={on} onClick={() => set({ results: { ...cfg.results, accounts: on ? cfg.results.accounts.filter((x) => x !== id) : [...cfg.results.accounts, id] } })}>{infos[id]?.label ?? id}</button>
              })}
              {accountIds.length === 0 && <span className="muted small">Chưa có tài khoản MT5 nào.</span>}
            </div>
            <div className="row" style={{ maxWidth: 280 }}><Field label="Chỉ đăng lệnh lãi/lỗ từ (tiền)" hint="0 = mọi lệnh"><input type="number" min={0} value={cfg.results.minNet} onChange={(e) => set({ results: { ...cfg.results, minNet: Math.max(0, e.target.valueAsNumber || 0) } })} /></Field></div>
          </div>
          <div className={`auto-job${cfg.weekly.on ? ' on' : ''}`}>
            <label className="switch"><input type="checkbox" checked={cfg.weekly.on} onChange={(e) => set({ weekly: { ...cfg.weekly, on: e.target.checked } })} /><span>Thống kê cuối tuần</span></label>
            <p className="muted small">Tổng pip, tỷ lệ thắng, profit factor của tuần, kèm ảnh.</p>
            <div className="row">
              <Field label="Ngày"><select value={cfg.weekly.weekday} onChange={(e) => set({ weekly: { ...cfg.weekly, weekday: Number(e.target.value) } })}>{WEEKDAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}</select></Field>
              <Field label="Giờ"><input type="time" value={cfg.weekly.time} onChange={(e) => set({ weekly: { ...cfg.weekly, time: e.target.value } })} /></Field>
            </div>
            <button className="ghost mini" disabled={!cfg.target} onClick={() => api.runNow('weekly')}>Tạo bài ngay</button>
          </div>
        </div>
        <p className="muted small">Chạy khi app đang mở (trên máy luôn bật hoặc VPS thì đều đặn nhất). Giờ đăng theo giờ máy tính.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Hàng chờ {pending.length > 0 && <span className="chip hot">{pending.length} chờ duyệt</span>}</h3>
          {state.queue.some((q) => q.status !== 'pending') && <button className="ghost mini" onClick={api.clearDone}>Xoá bài đã xử lý</button>}
        </div>
        {state.queue.length === 0 ? <p className="muted">Chưa có bài nào.</p> : (
          <div className="queue">
            {state.queue.map((q) => (
              <article key={q.id} className={`queue-item ${q.status}`}>
                {q.image && <img src={q.image} alt="" />}
                <div className="queue-body">
                  <header><strong>{KIND_TEXT[q.kind]}</strong><span className="muted small">{new Date(q.createdAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span><span className={`chip ${q.status === 'pending' ? 'hot' : q.status === 'error' ? 'off' : ''}`}>{STATUS_TEXT[q.status]}</span></header>
                  <div className="msg wide">{q.text}</div>
                  {q.error && <p className="notice bad">⚠ {q.error}</p>}
                  {(q.status === 'pending' || q.status === 'error') && (
                    <div className="actions"><button className="primary" disabled={!cfg.target} onClick={() => api.approve(q.id)}>Gửi lên {cfg.target || 'nhóm'}</button><button className="ghost" onClick={() => api.skip(q.id)}>Bỏ qua</button></div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
