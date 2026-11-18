import { useState } from 'react'
import Icon, { type IconName } from '../components/Icon'
import LiteCalc from '../lite/LiteCalc'
import LiteLearn from '../lite/LiteLearn'
import { BRAND_LOGO, BRAND_NAME } from '../lib/brand'
import { useAutoQuotes } from '../lib/quotes'
import { useMe } from '../lib/server'
import { useSettings } from '../lib/store'
import Login from './Login'
import ServerChat from './ServerChat'
import ServerMe from './ServerMe'
import ServerSignals from './ServerSignals'
import './server.css'

type Tab = 'signals' | 'calc' | 'chat' | 'learn' | 'me'
const TABS: [Tab, string, IconName][] = [
  ['signals', 'Tín hiệu', 'send'],
  ['calc', 'Tính lệnh', 'calc'],
  ['chat', 'Hỏi AI', 'chat'],
  ['learn', 'Học', 'book'],
  ['me', 'Tài khoản', 'user'],
]

/** Bản chạy trên máy chủ cho trader: đăng nhập, kênh tự thêm, tính lot, hỏi AI. Dùng giao diện của bản đơn giản. */
export default function ServerApp() {
  const { me, setMe, offline, reload } = useMe()
  const [settings, patch] = useSettings()
  const [tab, setTab] = useState<Tab>('signals')
  useAutoQuotes(patch, false)
  const go = (t: Tab) => { setTab(t); window.scrollTo(0, 0) }

  if (me === undefined)
    return <div className="lite srv-login">{offline ? <><p className="notice bad">⚠ {offline}</p><button className="primary lite-cta" onClick={reload}>Thử lại</button></> : <p className="muted">Đang mở…</p>}</div>
  if (me === null) return <Login onDone={(m) => { setMe(m); setTab('signals') }} />

  return (
    <div className="lite srv">
      <header className="lite-top">
        <img className="logo logo-img" src={BRAND_LOGO} alt="" />
        <strong className="lite-brand">{BRAND_NAME}</strong>
      </header>
      <main className="lite-main">
        {tab === 'signals' && <ServerSignals me={me} goCalc={() => go('calc')} goMe={() => go('me')} />}
        {tab === 'calc' && <LiteCalc settings={settings} patch={patch} />}
        {tab === 'chat' && <ServerChat me={me} onUsed={(left) => setMe({ ...me, chatToday: me.limits.chatPerDay - left })} goMe={() => go('me')} />}
        {tab === 'learn' && <LiteLearn />}
        {tab === 'me' && <ServerMe me={me} setMe={setMe} />}
      </main>
      <nav className="lite-nav srv-nav" aria-label="Mục chính">
        {TABS.map(([id, label, icon]) => (
          <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
            <Icon name={icon} size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
