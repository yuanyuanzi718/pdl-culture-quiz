import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Exam from './pages/Exam'
import Chat from './pages/Chat'
import Profile from './pages/Profile'
import AdminApp from './pages/admin/AdminApp'
import { useUserStore } from './store/user'

// 应用启动时静默登录（仅前台路由需要）；退出后 token 为空也会自动重新以游客身份登录
function useAutoLogin() {
  const { pathname } = useLocation()
  const token = useUserStore((s) => s.token)
  const autoLogin = useUserStore((s) => s.autoLogin)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [ready, setReady] = useState(pathname.startsWith('/admin'))
  useEffect(() => {
    if (pathname.startsWith('/admin')) {
      setReady(true)
      return
    }
    let mounted = true
    setError('')
    autoLogin()
      .catch((e) => { if (mounted) setError(e instanceof Error ? e.message : '连接服务失败') })
      .finally(() => {
        if (mounted) setReady(true)
      })
    return () => {
      mounted = false
    }
  }, [pathname, token, autoLogin, retry])
  return { ready, error, retry: () => setRetry((n) => n + 1) }
}

// 路由表：/admin/* 走管理后台，其余为前台 H5
export default function App() {
  const { ready, error, retry } = useAutoLogin()
  if (error) return <div className="p-8 text-center"><p role="alert">{error}</p><button onClick={retry} className="mt-4 rounded bg-red-700 px-5 py-2 text-white">重新连接</button></div>
  if (!ready) return null // 等游客登录完成再渲染，避免空请求
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/exam" replace />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route element={<Layout />}>
        <Route path="/exam" element={<Exam />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/me" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/exam" replace />} />
    </Routes>
  )
}
