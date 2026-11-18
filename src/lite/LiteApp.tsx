import { useState } from 'react'
import Icon, { type IconName } from '../components/Icon'
import ModeSwitch from './ModeSwitch'
import { BRAND_LOGO } from '../lib/brand'
import type { BrandPack } from '../lib/brandpack'
import type { InfoMap } from '../lib/accounts'
import type { BridgeState } from '../lib/bridge'
import type { PartnerLinks } from '../lib/partners'
import type { Profile } from '../lib/share'
import type { Settings, Trade } from '../lib/types'
import type { UserProfile } from '../lib/user'
import LiteCalc from './LiteCalc'
import LiteChat from './LiteChat'
import LiteHome from './LiteHome'
import LiteLearn from './LiteLearn'
import LiteOffers from './LiteOffers'
import LiteResults from './LiteResults'

export type LiteTab = 'home' | 'calc' | 'chat' | 'results' | 'learn' | 'offers'

const TABS: [LiteTab, string, IconName][] = [
  ['home', 'Trang chủ', 'home'],
  ['calc', 'Tính lệnh', 'calc'],
  ['chat', 'Hỏi AI', 'chat'],
  ['results', 'Kết quả', 'chart'],
  ['learn', 'Học', 'book'],
  ['offers', 'Ưu đãi', 'gift'],
]

export interface LiteProps {
  settings: Settings
  patch: (p: Partial<Settings>) => void
  trades: Trade[]
  setTrades: (t: Trade[]) => void
  bridge: BridgeState
  infos: InfoMap
  user: UserProfile
  profile: Profile
  pack: BrandPack
  links: PartnerLinks
  /** Sang bản đầy đủ, có thể mở thẳng một trang (vd. 'guides'). */
  goFull: (tab?: string) => void
}

/** Bản đơn giản: 5 mục ở thanh dưới, chữ to, không thuật ngữ. Mọi dữ liệu dùng chung với bản đầy đủ. */
export default function LiteApp(props: LiteProps) {
  const [tab, setTab] = useState<LiteTab>('home')
  const { profile, goFull } = props
  return (
    <div className="lite">
      <header className="lite-top">
        <img className="logo logo-img" src={BRAND_LOGO} alt="" />
        <strong className="lite-brand">{profile.brand}</strong>
        <ModeSwitch mode="lite" onChange={() => goFull()} />
      </header>
      <main className="lite-main">
        {tab === 'home' && <LiteHome {...props} go={setTab} />}
        {tab === 'calc' && <LiteCalc settings={props.settings} patch={props.patch} />}
        {tab === 'chat' && <LiteChat bridge={props.bridge} trades={props.trades} infos={props.infos} goFull={goFull} />}
        {tab === 'results' && <LiteResults trades={props.trades} setTrades={props.setTrades} settings={props.settings} goFull={goFull} />}
        {tab === 'learn' && <LiteLearn goFull={goFull} />}
        {tab === 'offers' && <LiteOffers pack={props.pack} links={props.links} disclaimer={profile.disclaimer} />}
      </main>
      <nav className="lite-nav" aria-label="Mục chính">
        {TABS.map(([id, label, icon]) => (
          <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); window.scrollTo(0, 0) }}>
            <Icon name={icon} size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
