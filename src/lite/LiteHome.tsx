import { useMemo } from 'react'
import Icon, { type IconName } from '../components/Icon'
import { money, signed } from '../lib/format'
import { DUCK_AVATAR } from '../lib/persona'
import { siteName, siteUrl } from '../lib/brand'
import type { LiteProps, LiteTab } from './LiteApp'
import { periodStarts, pnlSince } from './plain'

const TIPS = [
  'Luôn đặt stop loss trước khi vào lệnh. Không có stop loss, một lệnh xấu có thể xoá sạch tài khoản.',
  'Mỗi lệnh chỉ nên rủi ro tối đa 1–2% số vốn. Khi mới học, 0.5% là đủ.',
  'Thua 2 lệnh liên tiếp thì nghỉ hết ngày. Cố gỡ thường làm lỗ thêm.',
  'Đừng vào lệnh ngay trước tin mạnh (lãi suất, việc làm Mỹ). Giá có thể nhảy rất xa.',
  'Tập trên tài khoản demo ít nhất vài tuần trước khi dùng tiền thật.',
  'Không ai đoán đúng mọi lệnh. Thắng 4/10 lệnh vẫn có lãi nếu lệnh thắng lớn hơn lệnh thua.',
  'Chỉ dùng số tiền bạn chấp nhận mất được. Không vay tiền để trade.',
]

const ACTIONS: [LiteTab, IconName, string, string][] = [
  ['calc', 'calc', 'Tính lệnh', 'Nên vào bao nhiêu lot'],
  ['results', 'chart', 'Kết quả', 'Mình đang lãi hay lỗ'],
  ['learn', 'book', 'Học cơ bản', 'Pip, lot, stop loss là gì'],
  ['offers', 'gift', 'Ưu đãi', 'Mã giảm giá sàn, quỹ'],
]

export default function LiteHome({ user, bridge, trades, settings, profile, go }: LiteProps & { go: (t: LiteTab) => void }) {
  const name = user.displayName.trim().split(/\s+/).pop()
  const hour = new Date().getHours()
  const hello = hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
  const tip = TIPS[Math.floor(Date.now() / 86_400_000) % TIPS.length]
  const ccy = settings.accountCcy

  const { today, week } = useMemo(() => {
    const p = periodStarts(Date.now(), settings.serverOffset)
    return { today: pnlSince(trades, p.day), week: pnlSince(trades, p.week) }
  }, [trades, settings.serverOffset])

  const live = bridge.accounts
  const liveCcy = [...new Set(live.map((a) => a.currency))]
  const balance = live.reduce((s, a) => s + a.balance, 0)
  const floating = live.reduce((s, a) => s + a.equity - a.balance, 0)
  const open = live.reduce((s, a) => s + a.positions.length, 0)

  return (
    <>
      <h1 className="lite-hello">{hello}{name ? `, ${name}` : ''} 👋</h1>

      {live.length > 0 ? (
        <section className="lite-card lite-balance">
          <div className="lite-label">Tổng số dư {live.length > 1 ? `(${live.length} tài khoản)` : ''}</div>
          <div className="lite-big">{money(balance, liveCcy.length === 1 ? liveCcy[0] : '')}</div>
          <div className={floating > 0 ? 'lite-sub pos' : floating < 0 ? 'lite-sub neg' : 'lite-sub'}>
            {open ? `${open} lệnh đang mở · đang ${floating >= 0 ? 'lãi' : 'lỗ'} ${money(Math.abs(floating))}` : 'Không có lệnh nào đang mở'}
          </div>
          {liveCcy.length > 1 && <p className="muted small">Các tài khoản dùng nhiều loại tiền ({liveCcy.join(', ')}), số trên đang cộng thẳng.</p>}
        </section>
      ) : (
        <section className="lite-card lite-balance">
          <div className="lite-label">Kết quả của bạn</div>
          <div className="lite-period">
            <div><span>Hôm nay</span><strong className={today.net > 0 ? 'pos' : today.net < 0 ? 'neg' : ''}>{today.n ? `${signed(today.net)} ${ccy}` : '—'}</strong><small>{today.n} lệnh</small></div>
            <div><span>Tuần này</span><strong className={week.net > 0 ? 'pos' : week.net < 0 ? 'neg' : ''}>{week.n ? `${signed(week.net)} ${ccy}` : '—'}</strong><small>{week.n} lệnh</small></div>
          </div>
          {trades.length === 0 && <button className="lite-link" onClick={() => go('results')}>Chưa có lệnh nào. Thêm lịch sử lệnh →</button>}
        </section>
      )}

      <button className="lite-card lite-ask" onClick={() => go('chat')}>
        <img className="lite-duck" src={DUCK_AVATAR} alt="" />
        <span><strong>Hỏi Golden Duck</strong><small>Không hiểu gì cứ hỏi, AI giải thích dễ hiểu</small></span>
        <span className="lite-ask-go" aria-hidden="true">›</span>
      </button>

      <div className="lite-actions">
        {ACTIONS.map(([id, icon, title, sub]) => (
          <button key={id} className="lite-action" onClick={() => go(id)}>
            <span className="lite-action-icon"><Icon name={icon} size={24} /></span>
            <strong>{title}</strong>
            <small>{sub}</small>
          </button>
        ))}
      </div>

      {profile.website && (
        <a className="lite-card lite-site" href={siteUrl(profile.website)} target="_blank" rel="noreferrer">
          <span aria-hidden="true">🌐</span><span><strong>{siteName(profile.website)}</strong><small>Website của {profile.brand}</small></span><span className="lite-ask-go" aria-hidden="true">›</span>
        </a>
      )}

      <section className="lite-card lite-tip">
        <div className="lite-label">💡 Lời khuyên hôm nay</div>
        <p>{tip}</p>
      </section>
    </>
  )
}
