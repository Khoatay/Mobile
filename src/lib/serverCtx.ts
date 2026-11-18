import { createContext, useContext } from 'react'
import type { Me } from './server'

/** Người đang đăng nhập ở bản chạy trên máy chủ (null ở bản chạy trên máy tính cùng bridge). */
export const ServerCtx = createContext<{ me: Me; setMe: (m: Me | null) => void } | null>(null)
export const useServer = () => useContext(ServerCtx)
