import { useMemo, useState } from 'react'
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
  // Tên hiển thị cho từng tài khoản: nhãn đặt trong bridge nếu có, không thì là số tài khoản.
  const labels = useMemo(() => {
    const out: Record<string, string> = {}
    for (const t of trades) if (t.account) out[t.account] = t.account
    for (const m of bridge.metas) out[m.id] = m.label
    return out
  }, [trades, bridge.metas])

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
          <span className={bridge.accounts.length ? 'led on' : 'led'} />{' '}
          {!bridge.online ? 'Bridge chưa chạy' : `${bridge.accounts.length}/${bridge.metas.length} tài khoản MT5 đã nối`}
        </p>
        <p className="side-note plain">Dữ liệu chỉ lưu trên trình duyệt của máy này.</p>
      </aside>
      <main className="main">
        {tab === 'calc' && <Calculator settings={settings} patch={patchSettings} />}
        {tab === 'journal' && <Journal trades={trades} setTrades={setTrades} settings={settings} patch={patchSettings} labels={labels} />}
        {tab === 'stats' && <Dashboard trades={trades} settings={settings} labels={labels} goJournal={() => setTab('journal')} />}
        {tab === 'prop' && <Prop trades={trades} settings={settings} bridge={bridge} labels={labels} />}
        {tab === 'account' && <Account bridge={bridge} trades={trades} setTrades={setTrades} settings={settings} patch={patchSettings} />}
        {tab === 'signals' && <Signals bridge={bridge} settings={settings} />}
      </main>
    </div>
  )
}
