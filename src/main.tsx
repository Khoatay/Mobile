import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PREVIEW } from './lib/bridge'
import './styles.css'
import './theme.css'
import './lite/lite.css'

async function start() {
  if (PREVIEW) (await import('./lib/mockBridge')).seed()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
start()
