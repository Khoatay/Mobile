import App from '../App'
import { useMe } from '../lib/server'
import { ServerCtx } from '../lib/serverCtx'
import Login from './Login'
import './server.css'

/** Bản web trên tên miền: bắt đăng nhập, rồi mở bản đầy đủ. Gói Pro và AI do máy chủ quyết định. */
export default function ServerRoot() {
  const { me, setMe, offline, reload } = useMe()
  if (me === undefined)
    return <div className="lite srv-login">{offline ? <><p className="notice bad">⚠ {offline}</p><button className="primary lite-cta" onClick={reload}>Thử lại</button></> : <p className="muted">Đang mở…</p>}</div>
  if (me === null) return <Login onDone={setMe} />
  return <ServerCtx.Provider value={{ me, setMe }}><App /></ServerCtx.Provider>
}
