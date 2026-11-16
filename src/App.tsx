import { useEffect, useMemo, useState } from 'react'
import { resolveInfos, type AccountInfo } from './lib/accounts'
import { useBridge, useTelegramMessages } from './lib/bridge'
import { DEFAULT_PROFILE, type Profile } from './lib/share'
import { usePersistent, useSettings, useTrades } from './lib/store'
import Account from './pages/Account'
import Calculator from './pages/Calculator'
import Dashboard from './pages/Dashboard'
import Guides from './pages/Guides'
import Journal from './pages/Journal'
import Ledger from './pages/Ledger'
import News from './pages/News'
import Personalize from './pages/Personalize'
import Prop from './pages/Prop'
import Share from './pages/Share'
import Signals from './pages/Signals'

const GROUPS = [
  { title: 'Giao dịch', tabs: [['calc', 'Tính lot'], ['account', 'Tài khoản MT5'], ['prop', 'Luật quỹ']] },
  { title: 'Phân tích', tabs: [['journal', 'Nhật ký lệnh'], ['stats', 'Thống kê'], ['signals', 'Tín hiệu Telegram'], ['news', 'Tin tức']] },
  { title: 'Kinh doanh', tabs: [['ledger', 'Thu chi đầu tư'], ['share', 'Chia sẻ cộng đồng']] },
  { title: 'Khác', tabs: [['guides', 'Hướng dẫn'], ['me', 'Cá nhân hoá']] },
] as const
type Tab = (typeof GROUPS)[number]['tabs'][number][0]

export default function App() {
  const [tab, setTab] = useState<Tab>('calc')
  const [settings, patchSettings] = useSettings()
  const [trades, setTrades] = useTrades()
  const [stored, setProfile] = usePersistent<Profile>('fx.profile', DEFAULT_PROFILE)
  const profile = useMemo(() => ({ ...DEFAULT_PROFILE, ...stored }), [stored])
  const bridge = useBridge()
  const messages = useTelegramMessages(!!bridge.status?.telegram.connected)

  useEffect(() => { document.documentElement.style.setProperty('--accent', profile.accent) }, [profile.accent])
  useEffect(() => { document.title = profile.brand || 'FX Desk' }, [profile.brand])

  // Nhãn từng tài khoản (tên, broker, nhóm…): mặc định từ bridge, phần người dùng sửa lưu trong trình duyệt.
  const [storedInfo, setStoredInfo] = usePersistent<Record<string, Partial<AccountInfo>>>('fx.accountInfo', {})
  const tradeAccounts = useMemo(() => [...new Set(trades.map((t) => t.account).filter((a): a is string => !!a))], [trades])
  const infos = useMemo(() => resolveInfos(tradeAccounts, storedInfo, bridge.metas, bridge.accounts), [tradeAccounts, storedInfo, bridge.metas, bridge.accounts])
  const setInfo = (id: string, p: Partial<AccountInfo>) => setStoredInfo((all) => ({ ...all, [id]: { ...all[id], ...p } }))
  const labels = useMemo(() => Object.fromEntries(Object.entries(infos).map(([id, i]) => [id, i.label])), [infos])

  // Ghi lại tiền tệ của tài khoản khi đọc được từ MT5, để vẫn biết khi bridge tắt.
  useEffect(() => {
    const changed = bridge.accounts.filter((a) => storedInfo[a.id]?.currency !== a.currency)
    if (changed.length) setStoredInfo((all) => ({ ...all, ...Object.fromEntries(changed.map((a) => [a.id, { ...all[a.id], currency: a.currency }])) }))
  }, [bridge.accounts])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">{profile.brand || 'FX Desk'}{profile.tagline && <small>{profile.tagline}</small>}</div>
        <nav>
          {GROUPS.map((g) => (
            <div key={g.title} className="nav-group">
              <div className="nav-title">{g.title}</div>
              {g.tabs.map(([id, label]) => (
                <button key={id} className={tab === id ? 'nav active' : 'nav'} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
                  {label}
                  {id === 'journal' && trades.length > 0 && <span className="count">{trades.length}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <p className="side-note bridge-state">
          <span className={bridge.accounts.length ? 'led on' : 'led'} />{' '}
          {!bridge.online ? 'Bridge chưa chạy' : `${bridge.accounts.length}/${bridge.metas.length} tài khoản MT5 đã nối`}
        </p>
        <p className="side-note plain">Dữ liệu chỉ lưu trên trình duyệt của máy này.</p>
      </aside>
      <main className="main">
        {tab === 'calc' && <Calculator settings={settings} patch={patchSettings} />}
        {tab === 'journal' && <Journal trades={trades} setTrades={setTrades} settings={settings} patch={patchSettings} labels={labels} />}
        {tab === 'stats' && <Dashboard trades={trades} settings={settings} infos={infos} goJournal={() => setTab('journal')} />}
        {tab === 'prop' && <Prop trades={trades} settings={settings} bridge={bridge} labels={labels} infos={infos} />}
        {tab === 'account' && <Account bridge={bridge} trades={trades} setTrades={setTrades} settings={settings} patch={patchSettings} infos={infos} setInfo={setInfo} />}
        {tab === 'signals' && <Signals bridge={bridge} settings={settings} messages={messages} />}
        {tab === 'news' && <News bridge={bridge} messages={messages} />}
        {tab === 'ledger' && <Ledger bridge={bridge} settings={settings} labels={labels} infos={infos} />}
        {tab === 'share' && <Share bridge={bridge} trades={trades} settings={settings} profile={profile} labels={labels} infos={infos} />}
        {tab === 'guides' && <Guides />}
        {tab === 'me' && <Personalize profile={profile} setProfile={setProfile} />}
      </main>
    </div>
  )
}
