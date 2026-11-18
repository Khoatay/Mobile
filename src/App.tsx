import { useEffect, useMemo, useState } from 'react'
import Avatar from './components/Avatar'
import Icon, { type IconName } from './components/Icon'
import { DEFAULT_USER, type UserProfile } from './lib/user'
import { useBrandPack } from './lib/brandpack'
import { EDITION } from './lib/edition'
import { brandName, logoOf, siteName, siteUrl } from './lib/brand'
import { partnerLinks } from './lib/partners'
import { isView, resolveInfos, type AccountInfo } from './lib/accounts'
import { PREVIEW, useBridge, useTelegramMessages } from './lib/bridge'
import { DEFAULT_PROFILE, type Profile } from './lib/share'
import { usePersistent, useSettings, useTrades } from './lib/store'
import Account from './pages/Account'
import Analyze from './pages/Analyze'
import Learn from './pages/Learn'
import Calculator from './pages/Calculator'
import Dashboard from './pages/Dashboard'
import Guides from './pages/Guides'
import Journal from './pages/Journal'
import Ledger from './pages/Ledger'
import News from './pages/News'
import Offers from './pages/Offers'
import Shop from './pages/Shop'
import Community from './pages/Community'
import ProPage from './pages/ProPage'
import Guard from './pages/Guard'
import Copier from './pages/Copier'
import Track from './pages/Track'
import Chat from './pages/Chat'
import { ProLockPage } from './components/ProGate'
import { lockedTabs, PRO_FEATURES } from './lib/pro'
import { useAutopost } from './lib/useAutopost'
import { useAutoQuotes } from './lib/quotes'
import { useJournalSync } from './lib/journalSync'
import { useNewsWatch } from './lib/newsWatch'
import NewsAlertBar from './components/NewsAlertBar'
import type { SignalDraft } from './lib/share'
import ProfilePage from './pages/Profile'
import Personalize from './pages/Personalize'
import Prop from './pages/Prop'
import Share from './pages/Share'
import Signals from './pages/Signals'
import LiteApp from './lite/LiteApp'
import ModePicker from './lite/ModePicker'
/** Bản đầy đủ đặt trên tên miền ở /pc: vào thẳng giao diện đầy đủ, không hỏi chọn. */
const ON_WEB_PC = typeof location !== 'undefined' && location.pathname.startsWith('/pc/')
import ModeSwitch from './lite/ModeSwitch'
import type { Mode } from './lite/plain'

const GROUPS = [
  { title: 'Giao dịch', tone: 'gold', tabs: [['calc', 'Tính lot', 'calc'], ['account', 'Tài khoản', 'terminal'], ['prop', 'Quỹ', 'shield'], ['guard', 'Bảo vệ', 'lock'], ['copier', 'Copy lệnh', 'copy']] },
  { title: 'Phân tích', tone: 'sky', tabs: [['journal', 'Nhật ký lệnh', 'journal'], ['stats', 'Thống kê', 'chart'], ['learn', 'AI học trade', 'bulb'], ['ai', 'AI phân tích', 'sparkle'], ['chat', 'Golden Duck Talk', 'chat'], ['signals', 'Tín hiệu Telegram', 'send'], ['news', 'Tin tức', 'news']] },
  { title: 'Cộng đồng', tone: 'mint', tabs: [['offers', 'Ưu đãi', 'gift'], ['shop', 'Cửa hàng', 'bag'], ['community', 'Nhóm cộng đồng', 'users'], ['share', 'Chia sẻ cộng đồng', 'megaphone'], ['track', 'Thành tích công khai', 'trophy']] },
  { title: 'Cá nhân', tone: 'lilac', tabs: [['pro', 'Gói Pro', 'crown'], ['ledger', 'Thu chi đầu tư', 'coins'], ['guides', 'Hướng dẫn', 'book'], ['profile', 'Hồ sơ', 'user'], ['me', 'Cá nhân hoá', 'palette']] },
] as const
type Tab = (typeof GROUPS)[number]['tabs'][number][0]

export default function App() {
  const [tab, setTab] = useState<Tab>('calc')
  // Bản đơn giản cho người mới hoặc bản đầy đủ; '' = chưa chọn, hỏi ở màn hình chào.
  const [mode, setMode] = usePersistent<Mode | ''>('fx.mode', ON_WEB_PC ? 'full' : '')
  const [settings, patchSettings] = useSettings()
  const [trades, setTrades] = useTrades()
  const [stored, setProfile] = usePersistent<Profile>('fx.profile', DEFAULT_PROFILE)
  const { pack, setPack, loading: packLoading, error: packError } = useBrandPack()
  // Bản IB có thể xem thử giao diện của người dùng bản trader.
  const [viewAs, setViewAs] = usePersistent('fx.viewAs', false)
  const canEdit = EDITION === 'owner' && !viewAs
  const isPro = canEdit || pack.proForAll
  // Bản trader lấy thương hiệu từ gói cấu hình của IB; màu nhấn và việc ẩn tiền là lựa chọn riêng của người dùng.
  const profile = useMemo(() => {
    const base = { ...DEFAULT_PROFILE, ...stored }
    const p = EDITION === 'trader' ? { ...base, ...pack.brand, accent: stored.accentCustom ? stored.accent : pack.brand.accent } : base
    // Tên trống hoặc còn tên cũ "FX Desk" thì hiện Golden Duck.
    return { ...p, brand: brandName(p.brand) }
  }, [stored, pack.brand])
  const links = useMemo(() => partnerLinks(pack.partners), [pack.partners])
  const locked = useMemo(() => lockedTabs(pack.proFeatures, isPro), [pack.proFeatures, isPro])
  const featureLocked = (id: string) => !isPro && pack.proFeatures.includes(id)
  // Lệnh từ trang AI phân tích chuyển sang trang Chia sẻ để đăng thành tín hiệu.
  const [draft, setDraft] = useState<(SignalDraft & { credit: string }) | null>(null)
  const lockOf = (t: string) => PRO_FEATURES.find((f) => f.tab === t && pack.proFeatures.includes(f.id))?.id ?? ''
  const bridge = useBridge()
  // Giá quy đổi cho Tính lot: tự lấy từ MT5 hoặc internet khi mở app và mỗi 15 phút.
  const autoQuotes = useAutoQuotes(patchSettings, bridge.online)
  const [storedUser, setUser] = usePersistent<UserProfile>('fx.user', DEFAULT_USER)
  const user = useMemo(() => ({ ...DEFAULT_USER, ...storedUser }), [storedUser])
  const autopost = useAutopost({ online: bridge.online, trades, setTrades, profile, user, serverOffset: settings.serverOffset, currency: settings.accountCcy })
  const messages = useTelegramMessages(!!bridge.status?.telegram.connected)

  useEffect(() => { document.documentElement.style.setProperty('--accent', profile.accent) }, [profile.accent])
  useEffect(() => { document.title = profile.brand }, [profile.brand])
  // Icon trên tab trình duyệt theo logo của IB.
  useEffect(() => { document.querySelector<HTMLLinkElement>('link[rel=icon]')?.setAttribute('href', logoOf(profile)) }, [profile.logo])

  // Nhãn từng tài khoản (tên, broker, nhóm…): mặc định từ bridge, phần người dùng sửa lưu trong trình duyệt.
  const [storedInfo, setStoredInfo] = usePersistent<Record<string, Partial<AccountInfo>>>('fx.accountInfo', {})
  const tradeAccounts = useMemo(() => [...new Set(trades.map((t) => t.account).filter((a): a is string => !!a))], [trades])
  const infos = useMemo(() => resolveInfos(tradeAccounts, storedInfo, bridge.metas, bridge.accounts), [tradeAccounts, storedInfo, bridge.metas, bridge.accounts])
  const setInfo = (id: string, p: Partial<AccountInfo>) => setStoredInfo((all) => ({ ...all, [id]: { ...all[id], ...p } }))
  const labels = useMemo(() => Object.fromEntries(Object.entries(infos).map(([id, i]) => [id, i.label])), [infos])
  // Tài khoản Only view là của người khác: các trang về tiền, bảo vệ, chia sẻ và AI chỉ thấy tài khoản của bạn.
  const ownBridge = useMemo(() => ({ ...bridge, accounts: bridge.accounts.filter((a) => !isView(infos[a.id])), metas: bridge.metas.filter((m) => !isView(infos[m.id])) }), [bridge, infos])
  // Nhật ký tự đọc lịch sử lệnh của các tài khoản đã kết nối (không gồm Only view).
  const journalSync = useJournalSync(ownBridge, trades, setTrades)
  // Cảnh báo tin: bridge canh giờ và nhắc; app hiện thanh cảnh báo ở mọi trang.
  const newsWatch = useNewsWatch(bridge.online)
  const newsBar = <NewsAlertBar state={newsWatch.state} ack={newsWatch.ack} onOpen={mode === 'full' ? () => setTab('news') : undefined} />
  // Bấm "Copy lệnh của người này" ở trang Tài khoản: mở trang Copy lệnh với tài khoản đó làm nguồn.
  const [copyFrom, setCopyFrom] = useState('')

  // Ghi lại tiền tệ của tài khoản khi đọc được từ MT5, để vẫn biết khi bridge tắt.
  useEffect(() => {
    const changed = bridge.accounts.filter((a) => storedInfo[a.id]?.currency !== a.currency)
    if (changed.length) setStoredInfo((all) => ({ ...all, ...Object.fromEntries(changed.map((a) => [a.id, { ...all[a.id], currency: a.currency }])) }))
  }, [bridge.accounts])

  const previewBar = PREVIEW && <div className="preview-bar">Bản xem trước: dữ liệu giả lập, không nối MT5 hay Telegram thật. Lệnh, tin nhắn và tài khoản ở đây đều là mẫu.</div>
  if (mode === '') return <>{previewBar}<ModePicker brand={profile.brand} logo={logoOf(profile)} onPick={setMode} /></>
  if (mode === 'lite')
    return (
      <>
        {previewBar}
        {newsBar}
        <LiteApp settings={settings} patch={patchSettings} trades={trades} setTrades={setTrades} bridge={ownBridge} infos={infos} user={user} profile={profile} pack={pack} links={links}
          goFull={(t) => { if (t && GROUPS.some((g) => g.tabs.some(([id]) => id === t))) setTab(t as Tab); setMode('full'); window.scrollTo(0, 0) }} />
      </>
    )

  return (
    <>
    {previewBar}
    {newsBar}
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="logo logo-img" src={logoOf(profile)} alt="" />
          <span className="brand-text">{profile.brand}{profile.tagline && <small>{profile.tagline}</small>}{profile.website && <a className="brand-site" href={siteUrl(profile.website)} target="_blank" rel="noreferrer">🌐 {siteName(profile.website)}</a>}</span>
        </div>
        <ModeSwitch mode="full" onChange={(m) => { setMode(m); window.scrollTo(0, 0) }} dark />
        <nav>
          {GROUPS.map((g) => (
            <div key={g.title} className={`nav-group tone-${g.tone}`}>
              <div className="nav-title">{g.title}</div>
              {g.tabs.map(([id, label, icon]) => (
                <button key={id} className={tab === id ? 'nav active' : 'nav'} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
                  <span className="nav-label"><span className="nav-icon"><Icon name={icon as IconName} /></span>{label}{locked.has(id) && <span className="nav-lock" aria-label="Cần Pro">🔒</span>}</span>
                  {id === 'journal' && trades.length > 0 && <span className="count">{trades.length}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className={tab === 'profile' ? 'user-chip active' : 'user-chip'} onClick={() => setTab('profile')}>
          <Avatar src={user.avatar} name={user.displayName || user.username} size={32} />
          <span className="user-text"><strong>{user.displayName || 'Đặt tên của bạn'}</strong><small>{user.username ? `@${user.username}` : 'Hồ sơ'}</small></span>
        </button>
        {EDITION === 'owner' && (
          <label className={viewAs ? 'mode-switch on' : 'mode-switch'}>
            <input type="checkbox" checked={viewAs} onChange={(e) => setViewAs(e.target.checked)} />
            <span><strong>{viewAs ? 'Đang xem như người dùng' : 'Bản IB'}</strong><small>{viewAs ? 'Bỏ chọn để chỉnh cấu hình' : 'Xem như người dùng'}</small></span>
          </label>
        )}
        <p className="side-note bridge-state">
          <span className={bridge.accounts.length ? 'led on' : 'led'} />{' '}
          {!bridge.online ? 'Bridge chưa chạy' : `${bridge.accounts.length}/${bridge.metas.length} tài khoản MT5 đã nối`}
        </p>
        <p className="side-note plain">Dữ liệu chỉ lưu trên trình duyệt của máy này.</p>
      </aside>
      <main className="main">
        {EDITION === 'trader' && packLoading && <p className="muted small">Đang tải cấu hình của cộng đồng…</p>}
        {EDITION === 'trader' && packError && <p className="notice bad">⚠ {packError} Ưu đãi, cửa hàng và nhóm cộng đồng sẽ trống cho tới khi tải được.</p>}
        {tab === 'calc' && <Calculator settings={settings} patch={patchSettings} auto={autoQuotes} />}
        {tab === 'journal' && <Journal trades={trades} setTrades={setTrades} settings={settings} patch={patchSettings} labels={labels} infos={infos} bridge={ownBridge} sync={journalSync} />}
        {tab === 'stats' && <Dashboard trades={trades} settings={settings} infos={infos} goJournal={() => setTab('journal')} />}
        {tab === 'prop' && <Prop trades={trades} settings={settings} bridge={ownBridge} infos={infos} goAccounts={() => setTab('account')} links={links} />}
        {tab === 'account' && <Account onCopyFrom={(id) => { setCopyFrom(id); setTab('copier') }} bridge={bridge} trades={trades} setTrades={setTrades} settings={settings} patch={patchSettings} infos={infos} setInfo={setInfo} links={links} />}
        {tab === 'signals' && (locked.has('signals') ? <ProLockPage feature={lockOf('signals')} onOpenPro={() => setTab('pro')} /> : <Signals bridge={bridge} settings={settings} messages={messages} />)}
        {tab === 'guard' && (locked.has('guard') ? <ProLockPage feature={lockOf('guard')} onOpenPro={() => setTab('pro')} /> : <Guard bridge={ownBridge} trades={trades} settings={settings} infos={infos} />)}
        {tab === 'copier' && (locked.has('copier') ? <ProLockPage feature={lockOf('copier')} onOpenPro={() => setTab('pro')} /> : <Copier bridge={bridge} infos={infos} presetMaster={copyFrom} onPresetUsed={() => setCopyFrom('')} />)}
        {tab === 'learn' && (locked.has('learn') ? <ProLockPage feature={lockOf('learn')} onOpenPro={() => setTab('pro')} /> : <Learn bridge={bridge} />)}
        {tab === 'ai' && (locked.has('ai') ? <ProLockPage feature={lockOf('ai')} onOpenPro={() => setTab('pro')} /> : <Analyze bridge={bridge} settings={settings} shareLocked={featureLocked('copy-ai')} onShare={(d) => { if (featureLocked('copy-ai')) { setTab('pro'); return } setDraft(d); setTab('share') }} />)}
        {tab === 'news' && <News bridge={bridge} messages={messages} watch={newsWatch} />}
        {tab === 'ledger' && <Ledger bridge={ownBridge} settings={settings} labels={labels} infos={infos} />}
        {tab === 'share' && <Share bridge={ownBridge} trades={trades} settings={settings} profile={profile} labels={labels} infos={infos} user={user} messages={messages} locked={featureLocked} onOpenPro={() => setTab('pro')} draft={draft} onDraftUsed={() => setDraft(null)} autopost={autopost} />}
        {tab === 'offers' && <Offers links={links} bridge={bridge} disclaimer={profile.disclaimer} pack={pack} setPack={canEdit ? setPack : null} />}
        {tab === 'shop' && <Shop pack={pack} setPack={canEdit ? setPack : null} />}
        {tab === 'community' && <Community pack={pack} setPack={canEdit ? setPack : null} />}
        {tab === 'profile' && <ProfilePage user={user} setUser={setUser} trades={trades} online={bridge.online} />}
        {tab === 'chat' && <Chat bridge={ownBridge} trades={trades} infos={infos} />}
        {tab === 'track' && <Track trades={trades} infos={infos} profile={profile} links={links} currency={settings.accountCcy} />}
        {tab === 'guides' && <Guides links={links} />}
        {tab === 'me' && <Personalize profile={profile} setProfile={setProfile} canEdit={canEdit} online={bridge.online} />}
        {tab === 'pro' && <ProPage pack={pack} setPack={canEdit ? setPack : null} profile={profile} setProfile={setProfile} isPro={isPro} goTab={(t) => setTab(t as Tab)} />}
      </main>
    </div>
    </>
  )
}
