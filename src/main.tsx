import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PREVIEW } from './lib/bridge'
import { SERVER } from './lib/server'
import './styles.css'
import './theme.css'
import './lite/lite.css'

async function start() {
  if (PREVIEW) (await import('./lib/mockBridge')).seed()
  if (SERVER) {
    const { default: ServerRoot } = await import('./server/ServerRoot')
    createRoot(document.getElementById('root')!).render(<StrictMode><ServerRoot /></StrictMode>)
    return
  }
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
start()
