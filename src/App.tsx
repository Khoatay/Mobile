import { useState } from 'react'
import { useBridge } from './lib/bridge'
import { useSettings, useTrades } from './lib/store'
import Calculator from './pages/Calculator'
import Journal from './pages/Journal'
import Dashboard from './pages/Dashboard'
import Prop from './pages/Prop'
import Account from './pages/Account'
import Signals from './pages/Signals'

const TABS = [
  { id: 'calc', label: 'Tính lot' },
  { id: 'journal', label: 'Nhật ký lệnh' },
  { id: 'stats', label: 'Thống kê' },
  { id: 'prop', label: 'Luật quỹ' },
  { id: 'account', label: 'Tài khoản MT5' },
  { id: 'signals', label: 'Tín hiệu Telegram' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function App() {
  const [tab, setTab] = useState<Tab>('calc')
  const [settings, patchSettings] = useSettings()
  const [trades, setTrades] = useTrades()
  const bridge = useBridge()

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">FX Desk</div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'nav active' : 'nav'} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'journal' && trades.length > 0 && <span className="count">{trades.length}</span>}
            </button>
          ))}
        </nav>
        <p className="side-note bridge-state">
          <span className={bridge.account ? 'led on' : 'led'} /> {bridge.account ? 'MT5 đã kết nối' : bridge.online ? 'Bridge chạy, MT5 chưa nối' : 'Bridge chưa chạy'}
        </p>
        <p className="side-note plain">Dữ liệu chỉ lưu trên trình duyệt của máy này.</p>
      </aside>
      <main className="main">
        {tab === 'calc' && <Calculator settings={settings} patch={patchSettings} />}
        {tab === 'journal' && <Journal trades={trades} setTrades={setTrades} settings={settings} patch={patchSettings} />}
        {tab === 'stats' && <Dashboard trades={trades} settings={settings} goJournal={() => setTab('journal')} />}
        {tab === 'prop' && <Prop trades={trades} settings={settings} account={bridge.account} />}
        {tab === 'account' && <Account bridge={bridge} trades={trades} setTrades={setTrades} settings={settings} patch={patchSettings} />}
        {tab === 'signals' && <Signals bridge={bridge} settings={settings} />}
      </main>
    </div>
  )
}
