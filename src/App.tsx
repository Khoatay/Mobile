import { useState } from 'react'
import { useSettings, useTrades } from './lib/store'
import Calculator from './pages/Calculator'
import Journal from './pages/Journal'
import Dashboard from './pages/Dashboard'

const TABS = [
  { id: 'calc', label: 'Tính lot' },
  { id: 'journal', label: 'Nhật ký lệnh' },
  { id: 'stats', label: 'Thống kê' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function App() {
  const [tab, setTab] = useState<Tab>('calc')
  const [settings, patchSettings] = useSettings()
  const [trades, setTrades] = useTrades()

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
        <p className="side-note">Dữ liệu chỉ lưu trên trình duyệt của máy này.</p>
      </aside>
      <main className="main">
        {tab === 'calc' && <Calculator settings={settings} patch={patchSettings} />}
        {tab === 'journal' && <Journal trades={trades} setTrades={setTrades} settings={settings} patch={patchSettings} />}
        {tab === 'stats' && <Dashboard trades={trades} settings={settings} goJournal={() => setTab('journal')} />}
      </main>
    </div>
  )
}
