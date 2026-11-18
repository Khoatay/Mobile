import { useMemo } from 'react'
import Icon, { type IconName } from '../components/Icon'
import { money, signed } from '../lib/format'
import { DUCK_AVATAR } from '../lib/persona'
import { siteName, siteUrl } from '../lib/brand'
import { CATEGORIES, categoryOf } from '../lib/accounts'
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

export default function LiteHome({ user, bridge, trades, settings, profile, infos, go }: LiteProps & { go: (t: LiteTab) => void }) {
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
  // Tách số dư theo nhóm: tiền của bạn (Real), vốn quỹ cấp, tài khoản copy. Nhóm không có tài khoản thì ẩn.
  const groups = CATEGORIES.filter((c) => c.id !== 'view').map((c) => {
    const list = live.filter((a) => categoryOf(infos[a.id]) === c.id)
    const ccys = [...new Set(list.map((a) => a.currency))]
    return {
      c, list, ccy: ccys.length === 1 ? ccys[0] : '', mixed: ccys.length > 1,
      balance: list.reduce((s, a) => s + a.balance, 0),
      floating: list.reduce((s, a) => s + a.equity - a.balance, 0),
      open: list.reduce((s, a) => s + a.positions.length, 0),
    }
  }).filter((g) => g.list.length > 0)
  const GROUP_NOTE: Record<string, string> = { real: 'Tiền của bạn', prop: 'Vốn quỹ cấp, không phải tiền của bạn', copy: 'Tài khoản chép lệnh' }

  return (
    <>
      <h1 className="lite-hello">{hello}{name ? `, ${name}` : ''} 👋</h1>

      {live.length > 0 ? (
        <section className="lite-card lite-balances">
          <div className="lite-label">Số dư</div>
          {groups.map((g) => (
            <div key={g.c.id} className={`bal-row grp-${g.c.id}`}>
              <div className="bal-name"><span className={`grp-dot grp-${g.c.id}`} aria-hidden="true" /><strong>{g.c.label}</strong>{g.list.length > 1 && <small> · {g.list.length} tk</small>}<small className="bal-note">{GROUP_NOTE[g.c.id]}</small></div>
              <div className="bal-num">
                <strong>{money(g.balance, g.ccy)}</strong>
                <small className={g.floating > 0 ? 'pos' : g.floating < 0 ? 'neg' : 'muted'}>{g.open ? `${g.open} lệnh · ${g.floating >= 0 ? '+' : '−'}${money(Math.abs(g.floating))}` : 'Không có lệnh mở'}</small>
              </div>
            </div>
          ))}
          {groups.some((g) => g.mixed) && <p className="muted small">Có nhóm dùng nhiều loại tiền, số đang cộng thẳng.</p>}
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
