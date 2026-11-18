import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PREVIEW } from './lib/bridge'
import { SERVER } from './lib/server'
import './styles.css'
import './theme.css'
import './lite/lite.css'

async function start() {
  // Bản máy chủ không cần bridge: mọi dữ liệu lấy từ /api.
  if (SERVER) {
    const { default: ServerApp } = await import('./server/ServerApp')
    createRoot(document.getElementById('root')!).render(<StrictMode><ServerApp /></StrictMode>)
    return
  }
  if (PREVIEW) (await import('./lib/mockBridge')).seed()
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
start()
